import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { clientKey, rateLimit, resetRateLimit } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit then blocks", () => {
    const key = `k${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(rateLimit(key, 5, 60_000).allowed).toBe(true);
    const blocked = rateLimit(key, 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("reports remaining attempts", () => {
    const key = `k${Math.random()}`;
    expect(rateLimit(key, 3, 60_000).remaining).toBe(2);
    expect(rateLimit(key, 3, 60_000).remaining).toBe(1);
    expect(rateLimit(key, 3, 60_000).remaining).toBe(0);
  });

  it("frees the caller once the window elapses", () => {
    const key = `k${Math.random()}`;
    for (let i = 0; i < 3; i++) rateLimit(key, 3, 60_000);
    expect(rateLimit(key, 3, 60_000).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
  });

  it("tracks each client independently", () => {
    const a = `a${Math.random()}`;
    const b = `b${Math.random()}`;
    for (let i = 0; i < 3; i++) rateLimit(a, 3, 60_000);
    expect(rateLimit(a, 3, 60_000).allowed).toBe(false);
    expect(rateLimit(b, 3, 60_000).allowed).toBe(true);
  });

  it("resets on success so typos do not lock a legitimate user out", () => {
    const key = `k${Math.random()}`;
    for (let i = 0; i < 3; i++) rateLimit(key, 3, 60_000);
    resetRateLimit(key);
    expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });

  it("uses the left-most x-forwarded-for entry", () => {
    expect(clientKey(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then a constant", () => {
    expect(clientKey(req({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    // Never returns something unique-per-request, which would disable the limiter.
    expect(clientKey(req({}))).toBe("unknown");
  });
});
