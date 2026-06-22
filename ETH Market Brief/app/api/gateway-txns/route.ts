import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

function isVercelRuntime() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

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

function cleanCliMessage(message: string) {
  return message
    .split("\n")
    .filter((line) => !line.includes("[DEP0040]") && !line.includes("DeprecationWarning"))
    .join("\n")
    .trim();
}

async function runCircleJson(args: string[]) {
  try {
    const { stdout } = await execFileAsync("circle", [...args, "--output", "json"], {
      env: {
        ...process.env,
        CIRCLE_ACCEPT_TERMS: "1"
      },
      timeout: 30_000
    });

    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const cliError = error as { message?: string; stderr?: string; stdout?: string };
    const message = cleanCliMessage(cliError.stderr || cliError.stdout || cliError.message || "Circle CLI failed.");
    throw new Error(message || "Circle CLI failed.");
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

export async function GET(request: Request) {
  const address = process.env.SELAT_SIGNER_ADDRESS;
  const chain = toCircleChain(process.env.SELAT_CHAIN ?? "base");
  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  if (!address) {
    return NextResponse.json(
      {
        error: "Agent wallet is not configured.",
        setup: "Set SELAT_SIGNER_ADDRESS to show Gateway activity for the server-side agent wallet."
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

  if (isVercelRuntime()) {
    return NextResponse.json(
      {
        address,
        chain,
        setup:
          "Gateway transaction lookup uses the Circle CLI in this demo. On Vercel, wire a server-side Circle API integration or inspect Gateway activity locally."
      },
      { status: 501 }
    );
  }

  try {
    const [balance, transactions] = await Promise.all([
      runCircleJson(["gateway", "balance", "--address", address, "--chain", chain, "--all"]),
      runCircleJson(["transaction", "list", "--address", address, "--chain", chain, "--limit", "10"])
    ]);
    const paidCallTransactions = filterPaidCallTransactions(transactions, since);

    return NextResponse.json({
      address,
      chain,
      since,
      balance,
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
