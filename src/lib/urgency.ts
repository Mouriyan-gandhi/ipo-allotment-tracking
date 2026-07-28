// UI urgency bucketing for "days remaining". These thresholds are DISPLAY concerns
// (colour coding + the next-7/30/90-day filters), deliberately kept OUT of the date
// engine so the engine stays free of numeric literals and purely rule-driven.
//
//   red     : <= 7 days
//   amber   : 8 - 30 days
//   neutral : 31 - 90 days
//   muted   : > 90 days
//   expired : already passed (< 0)

export type UrgencyBucket = "expired" | "red" | "amber" | "neutral" | "muted";

export const URGENCY_THRESHOLDS = { red: 7, amber: 30, neutral: 90 } as const;

// Standard windows used by the "unlocking in next N days" filters + dashboard strip.
export const HORIZON_WINDOWS = [7, 30, 90] as const;
export type HorizonWindow = (typeof HORIZON_WINDOWS)[number];

export function urgencyBucket(daysRemaining: number): UrgencyBucket {
  if (daysRemaining < 0) return "expired";
  if (daysRemaining <= URGENCY_THRESHOLDS.red) return "red";
  if (daysRemaining <= URGENCY_THRESHOLDS.amber) return "amber";
  if (daysRemaining <= URGENCY_THRESHOLDS.neutral) return "neutral";
  return "muted";
}

// Tailwind class fragments per bucket, used by table cells / badges.
export const urgencyClasses: Record<UrgencyBucket, { text: string; bg: string; dot: string }> = {
  red: { text: "text-red-300", bg: "bg-red-500/15", dot: "bg-red-500" },
  amber: { text: "text-amber-300", bg: "bg-amber-500/15", dot: "bg-amber-500" },
  neutral: { text: "text-sky-300", bg: "bg-sky-500/10", dot: "bg-sky-500" },
  muted: { text: "text-zinc-400", bg: "bg-zinc-500/10", dot: "bg-zinc-500" },
  expired: { text: "text-zinc-600 line-through", bg: "bg-transparent", dot: "bg-zinc-700" },
};
