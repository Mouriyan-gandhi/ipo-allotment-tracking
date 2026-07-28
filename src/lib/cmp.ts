// ============================================================================
//  Current market price — the integration seam.
//
//  CMP is deliberately OUT OF SCOPE for v1. The column exists in the schema and the
//  UI, and always renders "—". This is the single place a future price feed plugs
//  in; nothing else needs to change.
//
//  It returns null rather than a stale, approximate or derived figure. A wrong price
//  next to a lock-in date is worse than no price at all, so nothing is fabricated.
// ============================================================================

export interface CmpQuote {
  /** Last traded price in ₹. */
  price: number;
  /** When the price was observed. */
  asOf: Date;
  /** Provider name, stored for traceability. */
  source: string;
}

/**
 * Fetch the current market price for a symbol.
 *
 * v1 always returns null — no provider is wired up. To add one, implement this
 * function and persist the result to `Ipo.cmp` / `Ipo.cmpUpdatedAt` (a good place to
 * call it is at the end of the daily sync run).
 */
export async function fetchCmp(symbol: string): Promise<CmpQuote | null> {
  void symbol;
  return null;
}
