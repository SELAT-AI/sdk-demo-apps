import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { randomBytes } from "node:crypto";
import { serializeTypedDataForCircle } from "./circle-developer-wallet-signer";

/**
 * Deposit USDC from a Circle developer-controlled wallet into Circle Gateway
 * using Eco's gasless Gateway Fast Deposits.
 *
 * Flow (see https://docs.eco.com/addresses/gateway-fast-deposits):
 *   1. POST /circle-gateway/v2/depositAddresses → a deterministic vault address,
 *      a quoted amount, and a deadline.
 *   2. Sign a USDC ERC-3009 `TransferWithAuthorization` (from wallet → vault)
 *      with the developer-controlled wallet via Circle's API. The wallet pays no
 *      gas — it only signs.
 *   3. POST /circle-gateway/v1/gasless/transferWithAuthorization → Eco's relayer
 *      pulls the USDC into the vault and a solver calls Circle Gateway's
 *      `depositFor`, crediting the recipient's unified balance.
 *
 * Because ERC-3009 verifies an ECDSA signature recovered to `from`, the
 * developer-controlled wallet must be an EOA (not a smart-contract account).
 */

const ECO_API_URL = "https://api.eco.com";

type EcoChainConfig = {
  chainId: number;
  usdc: `0x${string}`;
  // USDC's EIP-712 domain. `name` is "USD Coin" and `version` is "2" on these
  // mainnets (verified on-chain).
  domainName: string;
  domainVersion: string;
};

// Eco Gateway Fast Deposits are live from Base, Optimism, and Arbitrum.
const ECO_CHAINS: Record<string, EcoChainConfig> = {
  base: {
    chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    domainName: "USD Coin",
    domainVersion: "2"
  },
  optimism: {
    chainId: 10,
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    domainName: "USD Coin",
    domainVersion: "2"
  },
  arbitrum: {
    chainId: 42161,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    domainName: "USD Coin",
    domainVersion: "2"
  }
};

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
} as const;

export function getEcoChainConfig(chain: string) {
  return ECO_CHAINS[chain.toLowerCase()];
}

export function ecoSupportedChains() {
  return Object.keys(ECO_CHAINS);
}

// Parse a human USDC amount ("1.5") into 6-decimal base units ("1500000").
export function usdcToBaseUnits(amount: string) {
  const trimmed = amount.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Amount must be a positive number, e.g. 1.5.");
  }

  const [whole, fraction = ""] = trimmed.split(".");

  if (fraction.length > 6) {
    throw new Error("USDC supports at most 6 decimal places.");
  }

  const baseUnits = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6) || "0");

  if (baseUnits <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }

  return baseUnits.toString();
}

async function readEcoJson(response: Response, action: string) {
  const text = await response.text();
  let parsed: unknown = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const record = parsed as
      | { error?: unknown; message?: unknown; details?: { cause?: unknown; errorDesc?: unknown } }
      | null;
    const detail =
      record?.details?.cause ??
      record?.details?.errorDesc ??
      record?.error ??
      record?.message ??
      text;
    const detailText = detail
      ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`
      : "";

    throw new Error(`Eco ${action} failed (${response.status} ${response.statusText})${detailText}`);
  }

  return (parsed ?? {}) as Record<string, unknown>;
}

export type EcoDepositParams = {
  chain: string;
  amountBaseUnits: string;
  walletAddress: `0x${string}`;
  apiKey: string;
  entitySecret: string;
  walletId: string;
  dAppId?: string;
};

export type EcoDepositResult = {
  jobId: string;
  status: string;
  vaultAddress: string;
  amount: string;
  deadline: number;
  chainId: number;
  sourceChain: string;
};

export async function createEcoGaslessDeposit(params: EcoDepositParams): Promise<EcoDepositResult> {
  const config = getEcoChainConfig(params.chain);

  if (!config) {
    throw new Error(
      `Eco Gateway Fast Deposits support ${ecoSupportedChains().join(", ")} — not "${params.chain}".`
    );
  }

  const dAppEntry = params.dAppId ? { dAppID: params.dAppId } : {};

  // 1. Create the deposit vault.
  const vaultJson = await readEcoJson(
    await fetch(`${ECO_API_URL}/circle-gateway/v2/depositAddresses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceChainId: config.chainId,
        amount: params.amountBaseUnits,
        recipient: params.walletAddress,
        depositor: params.walletAddress,
        ...dAppEntry
      })
    }),
    "create deposit vault"
  );

  const vault = vaultJson.data as
    | { vaultAddress?: string; amount?: string; deadline?: number }
    | undefined;

  if (!vault?.vaultAddress || !vault.amount || !vault.deadline) {
    throw new Error("Eco depositAddresses response was missing vaultAddress, amount, or deadline.");
  }

  const vaultAddress = vault.vaultAddress;
  const quotedAmount = vault.amount;
  const deadline = vault.deadline;

  // 2. Sign the USDC ERC-3009 transfer authorization with the Circle wallet.
  const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const typedData = {
    domain: {
      name: config.domainName,
      version: config.domainVersion,
      chainId: config.chainId,
      verifyingContract: config.usdc
    },
    primaryType: "TransferWithAuthorization" as const,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    message: {
      from: params.walletAddress,
      to: vaultAddress as `0x${string}`,
      value: BigInt(quotedAmount),
      validAfter: 0n,
      validBefore: BigInt(deadline),
      nonce
    }
  };

  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: params.apiKey,
    entitySecret: params.entitySecret
  });

  const signResponse = await circle.signTypedData({
    walletId: params.walletId,
    data: serializeTypedDataForCircle(typedData),
    memo: "Eco gasless Gateway deposit"
  });

  const signature = signResponse.data?.signature;

  if (!signature) {
    throw new Error("Circle signTypedData did not return a signature.");
  }

  // 3. Submit the gasless transfer to Eco's relayer.
  const transferJson = await readEcoJson(
    await fetch(`${ECO_API_URL}/circle-gateway/v1/gasless/transferWithAuthorization`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainId: config.chainId,
        from: params.walletAddress,
        to: vaultAddress,
        value: quotedAmount,
        validAfter: "0",
        validBefore: String(deadline),
        nonce,
        signature,
        ...dAppEntry
      })
    }),
    "submit gasless transfer"
  );

  const job = transferJson.data as { id?: string; status?: string } | undefined;

  if (!job?.id) {
    throw new Error("Eco gasless transfer response was missing a job id.");
  }

  return {
    jobId: job.id,
    status: job.status ?? "PENDING",
    vaultAddress,
    amount: quotedAmount,
    deadline,
    chainId: config.chainId,
    sourceChain: params.chain
  };
}

export async function getEcoVaultStatus(chain: string, vaultAddress: string) {
  const config = getEcoChainConfig(chain);

  if (!config) {
    throw new Error(`Unsupported chain "${chain}".`);
  }

  const json = await readEcoJson(
    await fetch(
      `${ECO_API_URL}/circle-gateway/v2/depositAddresses/${vaultAddress}?sourceChainId=${config.chainId}`
    ),
    "read deposit status"
  );

  return json.data ?? json;
}
