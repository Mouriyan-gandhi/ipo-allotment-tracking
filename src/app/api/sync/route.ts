import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runSync } from "@/lib/sync";
import { ChittorgarhAdapter } from "@/lib/sources/chittorgarh";

// Ingestion is server-only and can take a while; never let it run at the edge.
export const runtime = "nodejs";
export const maxDuration = 60;

/** Manual "Sync now" — session-gated by proxy.ts. */
export async function POST() {
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
