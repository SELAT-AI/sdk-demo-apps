import { NextResponse } from "next/server";
import { listOffchainPaymentPayloads } from "@/lib/offchain-payload-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    payloads: listOffchainPaymentPayloads()
  });
}
