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
//
// These resolve through theme tokens (see globals.css) rather than fixed palette
// steps: `text-red-300` is legible on the dark surface but washes out on white, so
// each theme supplies its own tone behind the same utility name.
export const urgencyClasses: Record<UrgencyBucket, { text: string; bg: string; dot: string }> = {
  red: { text: "text-urgent-red", bg: "bg-dot-red/15", dot: "bg-dot-red" },
  amber: { text: "text-urgent-amber", bg: "bg-dot-amber/15", dot: "bg-dot-amber" },
  neutral: { text: "text-urgent-neutral", bg: "bg-dot-neutral/10", dot: "bg-dot-neutral" },
  muted: { text: "text-urgent-muted", bg: "bg-dot-muted/10", dot: "bg-dot-muted" },
  expired: { text: "text-fg-dim line-through", bg: "bg-transparent", dot: "bg-dot-muted" },
};
