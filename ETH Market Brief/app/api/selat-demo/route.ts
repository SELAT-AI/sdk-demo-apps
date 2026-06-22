import {
  RouterClient,
  createCircleAgentWalletSigner,
  createRemoteSigner,
  createViemSigner,
  type RouterClientOptions,
  type RouterFetchOptions
} from "@selat-ai/router-client";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getDemoEndpoint, toRouterFetchOptions } from "@/lib/demo-catalogue";
import {
  recordOffchainPaymentPayload,
  type OffchainPaymentPayload
} from "@/lib/offchain-payload-store";

export const runtime = "nodejs";

type DemoRequestBody = {
  endpointId?: string;
  url?: string;
  method?: string;
  preferProtocol?: "mpp" | "x402";
  headers?: Record<string, string>;
  body?: string;
};

function getChain(): RouterClientOptions["chain"] {
  return (process.env.SELAT_CHAIN ?? "base") as RouterClientOptions["chain"];
}

// Vercel (and any serverless platform) cannot run the local `circle` CLI that
// createCircleAgentWalletSigner shells out to: the binary is not bundled into
// the function and there is no authenticated `circle login` session on the
// ephemeral, read-only filesystem. Detect it so the CLI path is never attempted
// in production.
function isVercelRuntime() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

type DemoClientResult =
  | { client: RouterClient; setup?: never }
  | { client: null; setup: string };

// Build a signer that delegates EIP-712 signing to a hosted signing service
// (where the Circle CLI / Agent Wallet credentials actually live). This is the
// only Circle Agent Wallet path that works on Vercel.
//
// The service must accept `POST { address, typedData }` and respond with
// `{ signature }`. Because the SDK puts `signer.address` into the gateway
// authorization's `from` field, the service must sign with the key that
// recovers to SELAT_SIGNER_ADDRESS (i.e. the Agent Wallet's own signing key).
function createRemoteAgentWalletSigner(address: `0x${string}`, endpoint: string) {
  return createRemoteSigner(address, async ({ address: from, typedData }) => {
    const token = process.env.SELAT_SIGNER_API_TOKEN;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ address: from, typedData })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Remote signer request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
    }

    const data = (await response.json().catch(() => null)) as { signature?: string } | null;
    if (!data?.signature) {
      throw new Error("Remote signer response did not include a `signature`.");
    }

    return data.signature as `0x${string}`;
  });
}

function createDemoClient(): DemoClientResult {
  const chain = getChain();
  const routerUrl = process.env.SELAT_ROUTER_URL;
  const signerAddress = process.env.SELAT_SIGNER_ADDRESS as `0x${string}` | undefined;
  const remoteSignerUrl = process.env.SELAT_SIGNER_API_URL;

  // Preferred Agent Wallet path on serverless: delegate signing over HTTP.
  if (signerAddress && remoteSignerUrl) {
    return {
      client: new RouterClient({
        chain,
        routerUrl,
        signer: createRemoteAgentWalletSigner(signerAddress, remoteSignerUrl)
      })
    };
  }

  // Local-only Agent Wallet path: signs by spawning the local `circle` CLI.
  if (signerAddress) {
    if (isVercelRuntime()) {
      return {
        client: null,
        setup:
          "The Circle Agent Wallet path signs via the local `circle` CLI, which is unavailable on Vercel. " +
          "Set SELAT_SIGNER_API_URL to a hosted remote signer, or use X402_CLIENT_PRIVATE_KEY for a private-key demo."
      };
    }

    return {
      client: new RouterClient({
        chain,
        routerUrl,
        signer: createCircleAgentWalletSigner({ address: signerAddress, chain })
      })
    };
  }

  const privateKey = process.env.X402_CLIENT_PRIVATE_KEY as `0x${string}` | undefined;

  if (privateKey) {
    return {
      client: new RouterClient({
        chain,
        routerUrl,
        signer: createViemSigner(privateKey)
      })
    };
  }


  return {
    client: null,
    setup:
      "Set SELAT_SIGNER_ADDRESS + SELAT_SIGNER_API_URL for a Circle Agent Wallet on Vercel, " +
      "SELAT_SIGNER_ADDRESS alone for the local Circle CLI, " +
      "or X402_CLIENT_PRIVATE_KEY for a private-key demo."
  };
}

function mergeRequestOptions(endpointOptions: RouterFetchOptions, body: DemoRequestBody): RouterFetchOptions {
  return {
    ...endpointOptions,
    method: body.method ?? endpointOptions.method ?? "GET",
    headers: {
      ...((endpointOptions.headers as Record<string, string> | undefined) ?? {}),
      ...(body.headers ?? {})
    },
    body: body.body ?? endpointOptions.body,
    preferProtocol: body.preferProtocol ?? endpointOptions.preferProtocol
  };
}

function decodePaymentSignature(paymentSignature: string) {
  try {
    return JSON.parse(Buffer.from(paymentSignature, "base64").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function digestPaymentSignature(paymentSignature: string) {
  return createHash("sha256").update(paymentSignature).digest("hex");
}

function redactPaymentSignature(paymentSignature: string) {
  if (!paymentSignature) {
    return "[redacted]";
  }

  return `${paymentSignature.slice(0, 10)}...[redacted]...${paymentSignature.slice(-8)}`;
}

function redactDecodedPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactDecodedPayload(item));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => {
      if (/(signature|privateKey|secret|mnemonic|authorization)/i.test(key)) {
        return [key, "[redacted]"];
      }

      return [key, redactDecodedPayload(fieldValue)];
    })
  );
}

async function capturePaymentPayloads<T>(
  metadata: {
    chain: string;
    endpointId?: string;
    endpointName?: string;
    preferProtocol?: string;
    signerAddress?: string;
    targetUrl: string;
  },
  callback: () => Promise<T>
) {
  const captured: OffchainPaymentPayload[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const headers = new Headers(init?.headers ?? request?.headers);
    const paymentSignature = headers.get("PAYMENT-SIGNATURE");

    if (paymentSignature) {
      const decodedPayload = decodePaymentSignature(paymentSignature);
      const record = recordOffchainPaymentPayload({
        id: crypto.randomUUID(),
        capturedAt: new Date().toISOString(),
        targetUrl: metadata.targetUrl,
        paidRequestUrl: typeof input === "string" || input instanceof URL ? input.toString() : input.url,
        endpointId: metadata.endpointId,
        endpointName: metadata.endpointName,
        preferProtocol: metadata.preferProtocol,
        quoteId: headers.get("x-selat-quote-id") ?? undefined,
        paymentSignature: redactPaymentSignature(paymentSignature),
        paymentSignatureDigest: digestPaymentSignature(paymentSignature),
        decodedPayload: redactDecodedPayload(decodedPayload),
        chain: metadata.chain,
        signerAddress: metadata.signerAddress
      });

      captured.push(record);
    }

    return originalFetch(input, init);
  }) satisfies typeof fetch;

  try {
    const result = await callback();

    return { result, captured };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function readResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (contentType.includes("application/json")) {
    try {
      return {
        body: JSON.parse(text),
        bodyType: "json"
      };
    } catch {
      return {
        body: text,
        bodyType: "text"
      };
    }
  }

  return {
    body: text,
    bodyType: "text"
  };
}

export async function POST(request: Request) {
  const payload = (await request.json()) as DemoRequestBody;
  const endpoint = getDemoEndpoint(payload.endpointId ?? "");

  if (!endpoint && !payload.url) {
    return NextResponse.json(
      { error: "Choose an endpoint or provide a target URL." },
      { status: 400 }
    );
  }

  const { client, setup } = createDemoClient();
  const chain = getChain();

  if (!client) {
    return NextResponse.json(
      {
        error: "Signer is not configured.",
        setup
      },
      { status: 501 }
    );
  }

  const targetUrl = payload.url ?? endpoint?.url;

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing target URL." }, { status: 400 });
  }

  const endpointOptions = endpoint ? toRouterFetchOptions(endpoint) : { method: "GET", preferProtocol: "mpp" as const };
  const options = mergeRequestOptions(endpointOptions, payload);

  if (options.method === "GET") {
    delete options.body;
  }

  try {
    const { result: response, captured } = await capturePaymentPayloads(
      {
        chain,
        endpointId: endpoint?.id,
        endpointName: endpoint?.name,
        preferProtocol: options.preferProtocol,
        signerAddress: process.env.SELAT_SIGNER_ADDRESS,
        targetUrl
      },
      () => client.fetch(targetUrl, options)
    );
    const parsed = await readResponse(response);

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      offchainPayloads: captured,
      ...parsed
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SELAT request failure";

    return NextResponse.json(
      {
        error: message
      },
      { status: 500 }
    );
  }
}
