import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Circle Gateway balances API. It is unauthenticated and returns the unified
// USDC balance available to a depositor across Gateway domains. Pure HTTPS, so
// it runs on Vercel and any serverless platform unchanged.
const GATEWAY_API_URL = "https://gateway-api.circle.com";

// Circle Gateway domain ids per chain (see the Gateway API reference). Used to
// scope the balance query to the demo's configured chain.
const GATEWAY_DOMAINS: Record<string, number> = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  base: 6,
  polygon: 7,
  unichain: 10,
  sonic: 13,
  arc: 26
};

// Circle `Blockchain` enum value per chain — surfaced for display continuity
// with the previous CLI output.
function toCircleChain(chain: string) {
  switch (chain.toLowerCase()) {
    case "base":
      return "BASE";
    case "ethereum":
      return "ETH";
    case "arbitrum":
      return "ARB";
    case "avalanche":
      return "AVAX";
    case "optimism":
      return "OP";
    case "polygon":
      return "MATIC";
    case "unichain":
      return "UNI";
    case "monad":
      return "MONAD";
    default:
      return chain.toUpperCase();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findTransactions(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of ["transactions", "transactionList", "items", "records", "data"]) {
    const candidate = value[key];

    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  for (const child of Object.values(value)) {
    const transactions = findTransactions(child);

    if (transactions.length > 0) {
      return transactions;
    }
  }

  return [];
}

function transactionTime(transaction: Record<string, unknown>) {
  const value = transaction.createDate ?? transaction.firstConfirmDate ?? transaction.updateDate;

  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

function filterPaidCallTransactions(transactions: unknown, since: string) {
  const sinceTime = Date.parse(since);

  if (Number.isNaN(sinceTime)) {
    return [];
  }

  return findTransactions(transactions).filter((transaction) => {
    const createdAt = transactionTime(transaction);
    const operation = String(transaction.operation ?? "").toUpperCase();
    const transactionType = String(transaction.transactionType ?? "").toUpperCase();

    return (
      !Number.isNaN(createdAt) &&
      createdAt >= sinceTime &&
      operation === "CONTRACT_EXECUTION" &&
      transactionType === "OUTBOUND"
    );
  });
}

// Query the Gateway unified USDC balance for the wallet on the configured chain.
async function fetchGatewayBalance(address: string, chainKey: string) {
  const domain = GATEWAY_DOMAINS[chainKey.toLowerCase()];
  const source = domain === undefined ? { depositor: address } : { depositor: address, domain };

  const response = await fetch(`${GATEWAY_API_URL}/v1/balances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [source] })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Gateway balance request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  return response.json() as Promise<unknown>;
}

// Reshape the Gateway balance payload so the demo's generic field renderer
// surfaces the chain and amount per source.
function toDisplayBalance(raw: unknown, chain: string) {
  if (!isRecord(raw)) {
    return raw;
  }

  const balances = Array.isArray(raw.balances) ? raw.balances : [];

  return {
    token: raw.token ?? "USDC",
    balances: balances.map((entry) =>
      isRecord(entry)
        ? { chain, domain: entry.domain, depositor: entry.depositor, amount: entry.balance }
        : entry
    )
  };
}

export async function GET(request: Request) {
  const address = process.env.SELAT_SIGNER_ADDRESS;
  const chainKey = process.env.SELAT_CHAIN ?? "base";
  const chain = toCircleChain(chainKey);
  const apiKey = process.env.CIRCLE_API_KEY;
  const walletId = process.env.CIRCLE_WALLET_ID;
  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  if (!address) {
    return NextResponse.json(
      {
        error: "Wallet is not configured.",
        setup: "Set SELAT_SIGNER_ADDRESS to show Gateway activity for the server-side wallet."
      },
      { status: 501 }
    );
  }

  if (!since) {
    return NextResponse.json({
      address,
      chain,
      transactions: {
        data: {
          transactions: []
        }
      },
      message: "Run a paid API step to show Gateway transactions created by that call."
    });
  }

  if (!apiKey || !walletId) {
    return NextResponse.json(
      {
        address,
        chain,
        setup:
          "Set CIRCLE_API_KEY + CIRCLE_WALLET_ID to list Gateway transactions via Circle's API."
      },
      { status: 501 }
    );
  }

  try {
    const circle = initiateDeveloperControlledWalletsClient({
      apiKey,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? ""
    });

    const [balanceRaw, transactionsResponse] = await Promise.all([
      fetchGatewayBalance(address, chainKey),
      circle.listTransactions({
        walletIds: [walletId],
        operation: "CONTRACT_EXECUTION",
        txType: "OUTBOUND",
        order: "DESC",
        pageSize: 10,
        from: since
      })
    ]);

    const paidCallTransactions = filterPaidCallTransactions(
      transactionsResponse.data?.transactions,
      since
    );

    return NextResponse.json({
      address,
      chain,
      since,
      balance: toDisplayBalance(balanceRaw, chain),
      transactions: {
        data: {
          transactions: paidCallTransactions
        }
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        address,
        chain,
        error: error instanceof Error ? error.message : "Could not read Gateway activity."
      },
      { status: 500 }
    );
  }
}
