// ============================================================================
//  Pluggable IPO source adapters.
//
//  Every external data source implements IpoSourceAdapter. The sync engine tries
//  adapters in priority order and falls back on failure, so a broken source can be
//  disabled or swapped without touching the rest of the app.
//
//  Adapters return RAW records. They never write to the database and never compute
//  lock-in dates — mapping + persistence happens in the sync layer, so a source's
//  quirks stay contained here.
// ============================================================================

import type { Board } from "../lockin-rules";

/** How confident we are about the allotment date, mirrors the Prisma enum. */
export type AllotmentDateSource = "BASIS_OF_ALLOTMENT" | "ANCHOR_CIRCULAR" | "ESTIMATED";

/** A civil date as an ISO yyyy-MM-dd string (Asia/Kolkata calendar). */
export type IsoDate = string;

/** Summary row from a source's IPO listing/index. */
export interface RawIpoRecord {
  /** Stable id within the source, used to build the detail URL. */
  sourceId: string;
  /** Source-specific slug/path fragment, if any. */
  slug?: string;
  companyName: string;
  board: Board;
  symbol?: string;
  isin?: string;
  issueOpenDate?: IsoDate;
  issueCloseDate?: IsoDate;
  listingDate?: IsoDate;
  ipoPriceFinal?: number;
  issueSizeCr?: number;
  /** Name of the adapter that produced this row. */
  source: string;
}

/** Full detail for one IPO. All fields optional — unknown stays unknown. */
export interface RawIpoDetail extends RawIpoRecord {
  allotmentDate?: IsoDate;
  allotmentDateSource?: AllotmentDateSource;
  ipoPriceMin?: number;
  ipoPriceMax?: number;
  listingPrice?: number;
  anchorQtyShares?: bigint;
  anchorValueCr?: number;
  leadManagers?: string[];
  registrar?: string;
  subQib?: number;
  subNii?: number;
  subRetail?: number;
  subOverall?: number;
}

export interface IpoSourceAdapter {
  /** Stable identifier, stored on Ipo.source so rows are traceable to their origin. */
  name: string;
  /**
   * Lower number = tried first. A source whose data is less authoritative (e.g. a
   * third-party aggregator rather than the exchange) should sort later and be
   * treated as lower-trust by the UI.
   */
  priority: number;
  /** True if this is a third-party aggregator rather than an exchange/official filing. */
  lowerTrust: boolean;

  fetchUpcomingIPOs(): Promise<RawIpoRecord[]>;
  fetchIPODetail(symbolOrId: string, board: Board): Promise<RawIpoDetail | null>;
}
