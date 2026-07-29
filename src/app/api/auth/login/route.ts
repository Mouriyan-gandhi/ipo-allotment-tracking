import { NextResponse } from "next/server";
import { SESSION_COOKIE, checkPassword, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { clientKey, rateLimit, resetRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// One shared password guards everything, so this route is the only barrier on a
// public URL. Ten attempts per 10 minutes per client is invisible to someone typing
// a password and ruinous for anyone guessing.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  const key = `login:${clientKey(request)}`;
  const limit = rateLimit(key, MAX_ATTEMPTS, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: string };
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!password || !checkPassword(password)) {
    // Deliberately vague: this is the only auth surface, so don't hint at length etc.
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  // Successful sign-in clears the counter so a shared password typed wrong a few
  // times does not lock out the person who eventually gets it right.
  resetRateLimit(key);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  return res;
}
