// ============================================================================
//  Polite HTTP client for ingestion.
//
//  Every external fetch goes through here so rate limiting and retry policy are
//  enforced in one place rather than per-adapter. Design rules:
//    - one request at a time per host (no concurrency against a source)
//    - a minimum gap between requests to the same host
//    - retry with exponential backoff on transient failures (429/5xx/network)
//    - never retry a 4xx other than 429 — that's a real error, not a blip
//
//  Failures are EXPECTED, not exceptional: callers should handle null/throw and let
//  the UI degrade to stored data.
// ============================================================================

export interface FetchOptions {
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Total attempts including the first. */
  attempts?: number;
  /** Minimum gap enforced between two requests to the same host. */
  minGapMs?: number;
}

const DEFAULTS = {
  timeoutMs: 30_000,
  attempts: 3,
  minGapMs: 1_500,
};

// A browser-like UA. Chittorgarh's robots.txt allows general clients (`User-agent: *
// -> Allow: /`) and blocks AI-training crawlers specifically; we identify as a normal
// client and keep volume to roughly one sync per day.
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Serialises requests per host and enforces the minimum gap. */
const hostQueues = new Map<string, Promise<unknown>>();
const lastHitAt = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withHostQueue<T>(host: string, minGapMs: number, task: () => Promise<T>): Promise<T> {
  const prior = hostQueues.get(host) ?? Promise.resolve();
  const run = prior.then(async () => {
    const since = Date.now() - (lastHitAt.get(host) ?? 0);
    if (since < minGapMs) await sleep(minGapMs - since);
    try {
      return await task();
    } finally {
      lastHitAt.set(host, Date.now());
    }
  });
  // Keep the chain alive even if this task rejects, so one failure can't wedge the queue.
  hostQueues.set(
    host,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

/** Fetch text with retry/backoff and per-host rate limiting. Throws on final failure. */
export async function politeFetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { timeoutMs, attempts, minGapMs } = { ...DEFAULTS, ...opts };
  const host = new URL(url).host;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withHostQueue(host, minGapMs, async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
            headers: {
              "User-Agent": BROWSER_UA,
              Accept: "text/html,application/json,*/*",
              "Accept-Language": "en-IN,en;q=0.9",
              ...opts.headers,
            },
          });
          if (!res.ok) throw new HttpError(res.status, url);
          return await res.text();
        } finally {
          clearTimeout(timer);
        }
      });
    } catch (err) {
      lastErr = err;
      // Don't burn retries on genuine client errors (except rate limiting).
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      if (attempt < attempts) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.random() * 400);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function politeFetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const text = await politeFetchText(url, {
    ...opts,
    headers: { Accept: "application/json, text/plain, */*", ...opts.headers },
  });
  return JSON.parse(text) as T;
}
