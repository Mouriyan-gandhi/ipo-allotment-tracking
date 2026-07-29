// ============================================================================
//  Login throttling.
//
//  The whole app is gated by one shared password, so the login route is the only
//  thing standing between a public URL and the data. Without a limit, that password
//  can be attacked at request speed.
//
//  This is an in-process fixed window. On serverless each instance keeps its own
//  counter, so a determined attacker spread across instances gets more attempts than
//  the nominal limit — it raises the cost of brute force substantially without
//  pretending to be a distributed limiter. A strong password is still the real
//  defence; if this app ever holds anything sensitive, move to per-user accounts and
//  a shared store (Redis/Postgres) for limiting.
// ============================================================================

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Sweep expired buckets occasionally so a long-lived process cannot grow unbounded
// from unique client IPs.
function sweep(now: number) {
  if (buckets.size < 500) return;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  bucket.count++;
  const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
  if (bucket.count > limit) return { allowed: false, remaining: 0, retryAfter };
  return { allowed: true, remaining: limit - bucket.count, retryAfter };
}

/** Clear a key after a successful login so one user's typos don't lock them out. */
export function resetRateLimit(key: string) {
  buckets.delete(key);
}

/**
 * Best-effort client identity. Behind Vercel the left-most x-forwarded-for entry is
 * the real client; fall back to a constant so the limiter still applies globally
 * rather than silently allowing everything when no header is present.
 */
export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
