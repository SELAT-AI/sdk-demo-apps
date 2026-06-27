import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminCookieMaxAge,
  createSessionToken,
  isAdminConfigured,
  verifyPassword
} from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      {
        error: "Admin login is not configured.",
        setup: "Set ADMIN_PASSWORD to enable the admin area."
      },
      { status: 501 }
    );
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;

  if (!verifyPassword(body?.password)) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });

  response.cookies.set(ADMIN_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: adminCookieMaxAge()
  });

  return response;
}
