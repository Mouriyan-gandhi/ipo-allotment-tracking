// Display helpers. The golden rule: unknown renders as "—", never as 0 or a guess.

export const DASH = "—";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d).padStart(2, "0")} ${months[m - 1]} ${y}`;
}

export function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return v.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  return `₹${fmtNum(v)}`;
}

/** ₹ crore, compacted to two decimals. */
export function fmtCr(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  return `₹${fmtNum(v)} cr`;
}

/** Share counts arrive as strings because they are BigInt in the database. */
export function fmtShares(v: string | null | undefined): string {
  if (!v) return DASH;
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-IN") : v;
}

export function fmtDays(days: number): string {
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days}d`;
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
