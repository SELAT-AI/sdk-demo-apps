import {
  RouterClient,
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
  // This variant runs on Arc mainnet (chainId 5042) and draws from the
  // depositor EOA's Circle Gateway balance there.
  return (process.env.SELAT_CHAIN ?? "arc") as RouterClientOptions["chain"];
}

type DemoClientResult =
  | { client: RouterClient; setup?: never }
  | { client: null; setup: string };

// Private-key signing only. createViemSigner signs EIP-712 in-process with the
// depositor EOA's key, so each Gateway-batched payment is funded from that
// wallet's Arc Gateway balance. No Circle CLI and no signing service — fully
// serverless, deploys on Vercel as-is.
function createDemoClient(): DemoClientResult {
  const chain = getChain();
  const routerUrl = process.env.SELAT_ROUTER_URL;
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
      "Set X402_CLIENT_PRIVATE_KEY to the Arc Gateway depositor wallet's private key to run the demo."
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
