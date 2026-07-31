// ============================================================================
//  Throttling for the expensive public routes.
//
//  The app has no sign-in, so anything that costs real work — a scrape of
//  Chittorgarh, a serverless invocation — is reachable by anyone with the URL and
//  needs a ceiling of its own.
//
//  This is an in-process fixed window. On serverless each instance keeps its own
//  counter, so the effective limit across a scaled-out deployment is higher than the
//  nominal one — it bounds runaway or accidental hammering without pretending to be
//  a distributed limiter. If this ever needs a hard guarantee, move the counter to a
//  shared store (Redis/Postgres).
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
