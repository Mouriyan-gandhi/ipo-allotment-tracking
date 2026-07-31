import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runSync } from "@/lib/sync";
import { generateNotifications } from "@/lib/notifications";
import { ChittorgarhAdapter } from "@/lib/sources/chittorgarh";
import { timingSafeEqual } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily scheduled ingestion. Called by Vercel Cron at 02:30 UTC (08:00 IST).
 *
 * The app has no sign-in, so this route authenticates itself rather than relying on
 * any app-wide gate: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without
 * it, anyone could put the scrape on a schedule.
 */
function authorise(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  return provided.length > 0 && timingSafeEqual(provided, secret);
}

async function handle(request: Request) {
  if (!authorise(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    // Bounded so the run finishes inside the serverless timeout: only the current
    // calendar year (new IPOs can only appear there), and a small detail budget.
    // Historical years are a one-off `npm run backfill`, not daily work.
    const result = await runSync(prisma, {
      triggeredBy: "cron",
      adapters: [new ChittorgarhAdapter([new Date().getUTCFullYear()])],
      maxDetailFetches: 12,
    });
    const notifications = await generateNotifications(prisma);
    return NextResponse.json({ ...result, notificationsCreated: notifications });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, status: "FAILED" }, { status: 500 });
  }
}

// Vercel Cron issues GET; POST is accepted for manual curl testing.
export const GET = handle;
export const POST = handle;
