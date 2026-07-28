// ============================================================================
//  SINGLE SOURCE OF TRUTH for lock-in durations.
//
//  No lock-in duration (30, 90, 6, 12, 18, ...) may appear ANYWHERE else in the
//  codebase — the date engine and UI consume resolveLockinRules() output only.
//  SEBI changes these periodically, so they must be editable here, per-board via
//  Settings, and per-IPO via Ipo.lockinRuleOverride, without touching component code.
//
//  These string-union types intentionally mirror the Prisma enum *values*
//  ("MAINBOARD", "ANCHOR_T1", ...) so config and DB stay interchangeable.
// ============================================================================

export type Board = "MAINBOARD" | "SME";
export type LockinEventType = "ANCHOR_T1" | "ANCHOR_T2" | "PRE_IPO" | "PROMOTER";

export interface DurationRule {
  unit: "days" | "months";
  value: number;
}

export type BoardLockinRules = Record<LockinEventType, DurationRule>;

export const defaultLockinRules: Record<Board, BoardLockinRules> = {
  MAINBOARD: {
    ANCHOR_T1: { unit: "days", value: 30 },
    ANCHOR_T2: { unit: "days", value: 90 },
    PRE_IPO: { unit: "months", value: 6 },
    // ⚠ Low-confidence default — verify against the CURRENT SEBI ICDR before relying on it.
    PROMOTER: { unit: "months", value: 18 },
  },
  SME: {
    ANCHOR_T1: { unit: "days", value: 30 },
    ANCHOR_T2: { unit: "days", value: 90 },
    PRE_IPO: { unit: "months", value: 12 },
    // ⚠ Low-confidence default — verify against the CURRENT SEBI ICDR before relying on it.
    PROMOTER: { unit: "months", value: 18 },
  },
};

// Human-readable labels + metadata for the UI. PROMOTER is flagged low-confidence so
// no UI copy asserts it as fact.
export const eventTypeMeta: Record<
  LockinEventType,
  { label: string; short: string; lowConfidence: boolean }
> = {
  ANCHOR_T1: { label: "Anchor lock-in (tranche 1, 50%)", short: "Anchor 30d", lowConfidence: false },
  ANCHOR_T2: { label: "Anchor lock-in (tranche 2, 50%)", short: "Anchor 90d", lowConfidence: false },
  PRE_IPO: { label: "Pre-IPO / non-promoter shareholder lock-in", short: "Pre-IPO", lowConfidence: false },
  PROMOTER: { label: "Promoter lock-in (verify vs current SEBI ICDR)", short: "Promoter", lowConfidence: true },
};

/**
 * Resolution order (lowest → highest priority):
 *   global default  →  per-board Settings override  →  per-IPO override.
 * Each override is a partial map, so callers can override a single event type.
 */
export function resolveLockinRules(
  board: Board,
  settingsOverride?: Partial<BoardLockinRules>,
  ipoOverride?: Partial<BoardLockinRules>,
): BoardLockinRules {
  return {
    ...defaultLockinRules[board],
    ...settingsOverride,
    ...ipoOverride,
  };
}
