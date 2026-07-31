import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runSync } from "@/lib/sync";
import { ChittorgarhAdapter } from "@/lib/sources/chittorgarh";
import { rateLimit } from "@/lib/rate-limit";

// Ingestion is server-only and can take a while; never let it run at the edge.
export const runtime = "nodejs";
export const maxDuration = 60;

// The app is public, so anyone who loads a page can press "Sync now". Each press
// costs a scrape of Chittorgarh plus a serverless invocation, so the limit is
// deliberately global rather than per-IP: the source only publishes once a day, and
// one visitor's sync refreshes the data for everyone. A handful of runs per window
// still leaves room to retry after a failed fetch.
const MAX_SYNCS = 3;
const WINDOW_MS = 10 * 60 * 1000;

/** Manual "Sync now" — public, but throttled. */
export async function POST() {
  const limit = rateLimit("sync:manual", MAX_SYNCS, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Synced recently. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
        status: "FAILED",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  try {
    // Same bound as the cron route so the button cannot exceed the function timeout.
    // Use `npm run backfill` for historical years, which has no such limit.
    const result = await runSync(prisma, {
      triggeredBy: "manual",
      adapters: [new ChittorgarhAdapter([new Date().getUTCFullYear()])],
      maxDetailFetches: 12,
    });
    return NextResponse.json(result, { status: result.status === "FAILED" ? 502 : 200 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, status: "FAILED" },
      { status: 500 },
    );
  }
}
