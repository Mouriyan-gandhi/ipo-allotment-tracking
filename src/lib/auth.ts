// ============================================================================
//  Single shared-password gate (per the spec: one user, no account system).
//
//  A session is a signed, expiring token stored in an httpOnly cookie:
//      "<expiryEpochMs>.<base64url HMAC-SHA256>"
//
//  Signing uses Web Crypto rather than node:crypto because proxy.ts runs in an
//  edge-like context that may be deployed to the CDN, where node built-ins are not
//  available. Web Crypto works in both that context and in route handlers.
// ============================================================================

export const SESSION_COOKIE = "ipo_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secretKeyMaterial(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set — see .env.example");
  return new TextEncoder().encode(secret);
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    secretKeyMaterial() as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(payload));
  return toBase64Url(sig);
}

/** Constant-time string comparison, so signature checks don't leak timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(now: number = Date.now()): Promise<string> {
  const expiry = String(now + SESSION_TTL_MS);
  return `${expiry}.${await sign(expiry)}`;
}

/** True only if the token is well-formed, correctly signed, and unexpired. */
export async function verifySessionToken(
  token: string | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;

  const expiry = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  if (!/^\d+$/.test(expiry)) return false;
  if (Number(expiry) < now) return false;

  return timingSafeEqual(await sign(expiry), provided);
}

/** Compare a submitted password against APP_PASSWORD without leaking timing. */
export function checkPassword(submitted: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("APP_PASSWORD is not set — see .env.example");
  return timingSafeEqual(submitted, expected);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
} as const;
