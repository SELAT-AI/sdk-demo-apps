import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  createEcoGaslessDeposit,
  ecoSupportedChains,
  getEcoChainConfig,
  getEcoVaultStatus,
  usdcToBaseUnits
} from "@/lib/eco-gateway-deposit";

export const runtime = "nodejs";

type DepositConfig = {
  walletAddress?: `0x${string}`;
  apiKey?: string;
  entitySecret?: string;
  walletId?: string;
  chain: string;
  dAppId?: string;
};

function readConfig(): DepositConfig {
  return {
    walletAddress: process.env.SELAT_SIGNER_ADDRESS as `0x${string}` | undefined,
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    walletId: process.env.CIRCLE_WALLET_ID,
    chain: process.env.SELAT_CHAIN ?? "base",
    dAppId: process.env.ECO_DAPP_ID
  };
}

function missingConfig(config: DepositConfig) {
  const missing: string[] = [];
  if (!config.walletAddress) missing.push("SELAT_SIGNER_ADDRESS");
  if (!config.apiKey) missing.push("CIRCLE_API_KEY");
  if (!config.entitySecret) missing.push("CIRCLE_ENTITY_SECRET");
  if (!config.walletId) missing.push("CIRCLE_WALLET_ID");
  return missing;
}

// Confirm the configured wallet exists, its address matches SELAT_SIGNER_ADDRESS,
// and it is an EOA — ERC-3009 transferWithAuthorization needs an ECDSA signature
// that recovers to `from`, which a smart-contract account cannot provide.
async function assertEoaWallet(config: Required<Pick<DepositConfig, "apiKey" | "entitySecret" | "walletId" | "walletAddress">>) {
  const circle = initiateDeveloperControlledWalletsClient({
    apiKey: config.apiKey,
    entitySecret: config.entitySecret
  });

  const wallet = (await circle.getWallet({ id: config.walletId })).data?.wallet as
    | { address?: string; accountType?: string }
    | undefined;

  if (!wallet?.address) {
    throw new Error(`Circle wallet ${config.walletId} was not found.`);
  }

  if (wallet.address.toLowerCase() !== config.walletAddress.toLowerCase()) {
    throw new Error(
      `CIRCLE_WALLET_ID resolves to ${wallet.address}, which does not match SELAT_SIGNER_ADDRESS (${config.walletAddress}).`
    );
  }

  if (wallet.accountType && wallet.accountType.toUpperCase() === "SCA") {
    throw new Error(
      "The configured wallet is a smart-contract account (SCA). Eco gasless deposits use ERC-3009, which requires an EOA developer-controlled wallet."
    );
  }
}

export async function GET(request: Request) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const config = readConfig();
  const vault = new URL(request.url).searchParams.get("vault");

  // Vault status lookup.
  if (vault) {
    try {
      const status = await getEcoVaultStatus(config.chain, vault);
      return NextResponse.json({ status });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not read deposit status." },
        { status: 502 }
      );
    }
  }

  // Otherwise return the deposit configuration for the admin UI.
  const missing = missingConfig(config);
  const chainSupported = Boolean(getEcoChainConfig(config.chain));

  return NextResponse.json({
    chain: config.chain,
    chainSupported,
    supportedChains: ecoSupportedChains(),
    walletAddress: config.walletAddress ?? null,
    ready: missing.length === 0 && chainSupported,
    setup:
      missing.length > 0
        ? `Set ${missing.join(", ")} to enable Gateway deposits.`
        : !chainSupported
          ? `SELAT_CHAIN="${config.chain}" is not supported by Eco fast deposits (${ecoSupportedChains().join(", ")}).`
          : undefined
  });
}

export async function POST(request: Request) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const config = readConfig();
  const missing = missingConfig(config);

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Set ${missing.join(", ")} to enable Gateway deposits.` },
      { status: 501 }
    );
  }

  if (!getEcoChainConfig(config.chain)) {
    return NextResponse.json(
      {
        error: `SELAT_CHAIN="${config.chain}" is not supported by Eco fast deposits (${ecoSupportedChains().join(", ")}).`
      },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => null)) as { amount?: unknown } | null;

  if (typeof body?.amount !== "string") {
    return NextResponse.json({ error: "Provide an amount (USDC) to deposit." }, { status: 400 });
  }

  let amountBaseUnits: string;

  try {
    amountBaseUnits = usdcToBaseUnits(body.amount);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid amount." },
      { status: 400 }
    );
  }

  try {
    await assertEoaWallet({
      apiKey: config.apiKey!,
      entitySecret: config.entitySecret!,
      walletId: config.walletId!,
      walletAddress: config.walletAddress!
    });

    const result = await createEcoGaslessDeposit({
      chain: config.chain,
      amountBaseUnits,
      walletAddress: config.walletAddress!,
      apiKey: config.apiKey!,
      entitySecret: config.entitySecret!,
      walletId: config.walletId!,
      dAppId: config.dAppId
    });

    return NextResponse.json({ deposit: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create the deposit." },
      { status: 502 }
    );
  }
}
