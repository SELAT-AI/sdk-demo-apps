import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient
} from "@circle-fin/developer-controlled-wallets";
import { recoverTypedDataAddress } from "viem";
import type { PaymentSigner } from "@selat-ai/router-client";

/**
 * Signs SELAT x402 / MPP payment authorizations with a Circle
 * developer-controlled wallet via Circle's REST API
 * (`POST /v1/w3s/developer/sign/typedData`).
 *
 * Unlike the local `circle` CLI path, this is a pure HTTPS call, so it runs on
 * Vercel and any other serverless platform unchanged. Signer material (the API
 * key and entity secret) lives only on the server; the browser never sees it.
 *
 * For Gateway-batched payments the wallet is a smart-contract account (SCA), so
 * the EIP-712 signature must come from the SCA's owner EOA. We replicate the
 * owner-resolution probe that the SDK's `createHttpRemoteSigner` performs: sign
 * a zero-value Gateway authorization, then `ecrecover` the owner. This keeps the
 * signer a drop-in replacement that is correct for both EOA and SCA wallets.
 */

type SignTypedDataParams = Parameters<PaymentSigner["signTypedData"]>[0];

export type CircleDeveloperWalletSignerOptions = {
  /** The wallet's on-chain address (the SCA address for Gateway-batched flows). */
  address: `0x${string}`;
  /** Circle developer-controlled wallet id whose key signs. */
  walletId: string;
  /** Circle API key. */
  apiKey: string;
  /** Circle entity secret (32-byte hex). The SDK encrypts it per request. */
  entitySecret: string;
  /** Override the Circle client (mainly for tests). */
  client?: CircleDeveloperControlledWalletsClient;
};

const GATEWAY_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
} as const;

// EIP-712 domain field types, in canonical order. Circle expects raw EIP-712
// JSON, so the `EIP712Domain` type entry must be present (viem omits it).
const EIP712_DOMAIN_FIELDS: Array<{ name: string; type: string }> = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" }
];

function normalizeAddress(address: string) {
  return address.toLowerCase() as `0x${string}`;
}

function buildGatewayOwnerProbeTypedData(
  walletAddress: `0x${string}`,
  input: { chainId: number; verifyingContract?: `0x${string}`; version?: string }
) {
  return {
    domain: {
      name: "GatewayWalletBatched",
      version: input.version ?? "1",
      chainId: input.chainId,
      verifyingContract: input.verifyingContract
    },
    primaryType: "TransferWithAuthorization" as const,
    types: GATEWAY_AUTH_TYPES,
    message: {
      from: walletAddress,
      to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      value: 0n,
      validAfter: 0n,
      validBefore: 0n,
      nonce: ("0x" + "0".repeat(64)) as `0x${string}`
    }
  } satisfies SignTypedDataParams;
}

// Circle's `data` field is a stringified EIP-712 payload. Inject the
// `EIP712Domain` type entry (derived from the domain keys actually present) and
// serialize bigints as decimal strings, which EIP-712 consumers accept.
export function serializeTypedDataForCircle(typedData: SignTypedDataParams) {
  const domain = (typedData.domain ?? {}) as Record<string, unknown>;
  const eip712Domain = EIP712_DOMAIN_FIELDS.filter((field) => domain[field.name] !== undefined);

  const payload = {
    domain,
    primaryType: typedData.primaryType,
    types: {
      EIP712Domain: eip712Domain,
      ...typedData.types
    },
    message: typedData.message
  };

  return JSON.stringify(payload, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

export function createCircleDeveloperWalletSigner(
  options: CircleDeveloperWalletSignerOptions
): PaymentSigner {
  const client =
    options.client ??
    initiateDeveloperControlledWalletsClient({
      apiKey: options.apiKey,
      entitySecret: options.entitySecret
    });

  const walletAddress = normalizeAddress(options.address);
  let effectiveAddress = walletAddress;
  let resolvedOwnerAddress: `0x${string}` | null = null;
  let resolveOwnerInFlight: Promise<`0x${string}`> | null = null;

  const requestSignature = async (typedData: SignTypedDataParams) => {
    const response = await client.signTypedData({
      walletId: options.walletId,
      data: serializeTypedDataForCircle(typedData),
      memo: "SELAT x402/MPP payment authorization"
    });

    const signature = response.data?.signature;

    if (!signature) {
      throw new Error("Circle signTypedData response did not include a `signature`.");
    }

    return signature as `0x${string}`;
  };

  const resolveOwnerAddress = async (input: {
    chainId: number;
    verifyingContract?: `0x${string}`;
    version?: string;
  }) => {
    if (!input.verifyingContract) {
      return walletAddress;
    }

    if (resolvedOwnerAddress) {
      return resolvedOwnerAddress;
    }

    if (!resolveOwnerInFlight) {
      const probeTypedData = buildGatewayOwnerProbeTypedData(walletAddress, input);

      resolveOwnerInFlight = requestSignature(probeTypedData)
        .then((signature) =>
          recoverTypedDataAddress({
            domain: probeTypedData.domain,
            types: probeTypedData.types,
            primaryType: probeTypedData.primaryType,
            message: probeTypedData.message,
            signature
          })
        )
        .then((owner) => {
          resolvedOwnerAddress = normalizeAddress(owner);
          effectiveAddress = resolvedOwnerAddress;
          return resolvedOwnerAddress;
        })
        .finally(() => {
          resolveOwnerInFlight = null;
        });
    }

    return resolveOwnerInFlight;
  };

  return {
    get address() {
      return effectiveAddress;
    },
    circleAgentWalletProcessor: async (input) => {
      await resolveOwnerAddress(input);
    },
    signTypedData: async (typedData) => requestSignature(typedData)
  };
}
