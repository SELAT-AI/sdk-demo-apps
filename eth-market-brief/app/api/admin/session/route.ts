import { NextResponse } from "next/server";
import { isAdminConfigured, requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return NextResponse.json({
    adminConfigured: isAdminConfigured(),
    authenticated: requireAdmin(request)
  });
}
