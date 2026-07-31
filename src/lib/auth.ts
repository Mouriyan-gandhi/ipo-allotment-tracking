// ============================================================================
//  The app itself is public — no sign-in, no session cookie, no shared password.
//
//  The one thing still authenticated is the scheduled ingestion route
//  (/api/cron/sync), which Vercel Cron calls with a bearer token. A constant-time
//  compare for that token is all that remains here.
//
//  Hand-rolled rather than node:crypto.timingSafeEqual because the route may run in
//  a context where node built-ins are not guaranteed.
// ============================================================================

/** Constant-time string comparison, so token checks don't leak content via timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
