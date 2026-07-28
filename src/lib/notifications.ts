// ============================================================================
//  Alerts.
//
//  Scheduling logic is deliberately independent of delivery: it decides WHICH
//  notifications are due, and a NotificationChannel decides HOW they are delivered.
//  Adding email later means implementing the interface and enabling a rule — no
//  changes to the scheduler.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import { daysRemaining } from "./date-engine";
import { eventTypeMeta, type LockinEventType } from "./lockin-rules";
import { fmtDate } from "./format";

export interface NotificationPayload {
  ipoId: string;
  eventType: LockinEventType;
  message: string;
  scheduledFor: Date;
}

export interface NotificationChannel {
  readonly name: "IN_APP" | "EMAIL";
  /** Returns true if the notification was accepted for delivery. */
  send(payload: NotificationPayload, prisma: PrismaClient): Promise<boolean>;
}

/** Writes to the notifications table; surfaced by the in-app inbox. */
export class InAppChannel implements NotificationChannel {
  readonly name = "IN_APP" as const;

  async send(payload: NotificationPayload, prisma: PrismaClient): Promise<boolean> {
    // De-duplicate: one notification per (ipo, event, scheduled day).
    const existing = await prisma.notification.findFirst({
      where: {
        ipoId: payload.ipoId,
        eventType: payload.eventType,
        scheduledFor: payload.scheduledFor,
      },
      select: { id: true },
    });
    if (existing) return false;

    await prisma.notification.create({
      data: {
        ipoId: payload.ipoId,
        eventType: payload.eventType,
        message: payload.message,
        scheduledFor: payload.scheduledFor,
        sentAt: new Date(),
      },
    });
    return true;
  }
}

/**
 * Stub. Implemented against the interface so email can be switched on via config
 * rather than a rewrite; intentionally not wired to a provider.
 */
export class EmailChannel implements NotificationChannel {
  readonly name = "EMAIL" as const;

  async send(): Promise<boolean> {
    // No provider configured. Returning false keeps the run honest rather than
    // recording a delivery that never happened.
    return false;
  }
}

export function channelFor(name: "IN_APP" | "EMAIL"): NotificationChannel {
  return name === "IN_APP" ? new InAppChannel() : new EmailChannel();
}

/**
 * Create notifications for every enabled AlertRule whose offset matches an event's
 * remaining days. Run daily by the cron route.
 */
export async function generateNotifications(prisma: PrismaClient): Promise<number> {
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } });
  if (rules.length === 0) return 0;

  const events = await prisma.lockinEvent.findMany({
    include: { ipo: { select: { id: true, symbol: true, companyName: true, board: true } } },
  });

  let created = 0;
  for (const event of events) {
    const remaining = daysRemaining(event.tradingDayExpiryDate);
    if (remaining < 0) continue;

    for (const rule of rules) {
      if (rule.eventType !== event.eventType) continue;
      if (rule.offsetDays !== remaining) continue;

      const meta = eventTypeMeta[event.eventType as LockinEventType];
      const who = event.ipo.symbol ?? event.ipo.companyName;
      const when =
        remaining === 0 ? "today" : remaining === 1 ? "tomorrow" : `in ${remaining} days`;

      const ok = await channelFor(rule.channel).send(
        {
          ipoId: event.ipo.id,
          eventType: event.eventType as LockinEventType,
          message: `${who} — ${meta.short} lock-in expires ${when} (${fmtDate(
            event.tradingDayExpiryDate.toISOString().slice(0, 10),
          )})`,
          scheduledFor: event.tradingDayExpiryDate,
        },
        prisma,
      );
      if (ok) created++;
    }
  }
  return created;
}
