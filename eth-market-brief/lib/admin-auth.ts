import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal password-based admin session for the demo's privileged actions
 * (funding the Gateway balance). A correct password mints a short-lived,
 * HMAC-signed, httpOnly cookie — no database, no external auth dependency.
 *
 * Enable it by setting `ADMIN_PASSWORD`. `ADMIN_SESSION_SECRET` is the HMAC key
 * for session cookies; if unset it falls back to `ADMIN_PASSWORD`, so the
 * single env var is enough to get started (set a distinct secret in production).
 */

export const ADMIN_COOKIE = "selat_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export function adminCookieMaxAge() {
  return SESSION_TTL_SECONDS;
}

export function isAdminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");

  if (ab.length !== bb.length) {
    return false;
  }

  return timingSafeEqual(ab, bb);
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

export function verifyPassword(input: unknown) {
  const password = process.env.ADMIN_PASSWORD;

  if (!password || typeof input !== "string") {
    return false;
  }

  return safeEqual(input, password);
}

export function createSessionToken() {
  const expiry = String(Date.now() + SESSION_TTL_SECONDS * 1000);

  return `${expiry}.${sign(expiry)}`;
}

export function verifySessionToken(token: string | undefined) {
  if (!token) {
    return false;
  }

  const [expiry, signature] = token.split(".");

  if (!expiry || !signature || !safeEqual(signature, sign(expiry))) {
    return false;
  }

  const expiresAt = Number(expiry);

  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function readSessionCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(/; */)
    .find((entry) => entry.startsWith(`${ADMIN_COOKIE}=`));

  return match ? decodeURIComponent(match.slice(ADMIN_COOKIE.length + 1)) : undefined;
}

export function requireAdmin(request: Request) {
  return verifySessionToken(readSessionCookie(request));
}
