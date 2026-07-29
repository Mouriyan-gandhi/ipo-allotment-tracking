"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IpoRow } from "@/lib/queries";

/**
 * Manual Add/Edit — the safety net for when ingestion cannot reach a source or gets
 * a field wrong. allotmentDate is the only required field; everything else may be
 * left blank and will render as "—".
 */
export function IpoForm({ initial, onDone }: { initial?: IpoRow; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const numOrBlank = (k: string) => {
      const v = String(fd.get(k) ?? "").trim();
      return v === "" ? "" : Number(v);
    };

    const payload = {
      id: initial?.id,
      companyName: String(fd.get("companyName") ?? ""),
      board: String(fd.get("board") ?? "MAINBOARD"),
      allotmentDate: String(fd.get("allotmentDate") ?? ""),
      symbol: String(fd.get("symbol") ?? ""),
      isin: String(fd.get("isin") ?? ""),
      listingDate: String(fd.get("listingDate") ?? ""),
      issueOpenDate: String(fd.get("issueOpenDate") ?? ""),
      issueCloseDate: String(fd.get("issueCloseDate") ?? ""),
      ipoPriceFinal: numOrBlank("ipoPriceFinal"),
      issueSizeCr: numOrBlank("issueSizeCr"),
      anchorValueCr: numOrBlank("anchorValueCr"),
      anchorQtyShares: String(fd.get("anchorQtyShares") ?? ""),
      registrar: String(fd.get("registrar") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    };

    try {
      const res = await fetch("/api/ipos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Save failed");
        return;
      }
      router.refresh();
      onDone?.();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name" required>
          <input name="companyName" required defaultValue={initial?.companyName} className={INPUT} />
        </Field>
        <Field label="Board" required>
          <select name="board" defaultValue={initial?.board ?? "MAINBOARD"} className={INPUT}>
            <option value="MAINBOARD">Mainboard</option>
            <option value="SME">SME</option>
          </select>
        </Field>
        <Field label="Allotment date" required hint="The only required date — everything is computed from it">
          <input
            type="date"
            name="allotmentDate"
            required
            defaultValue={initial?.allotmentDate ?? ""}
            className={INPUT}
          />
        </Field>
        <Field label="Symbol">
          <input name="symbol" defaultValue={initial?.symbol ?? ""} className={INPUT} placeholder="unassigned until listing" />
        </Field>
        <Field label="Listing date">
          <input type="date" name="listingDate" defaultValue={initial?.listingDate ?? ""} className={INPUT} />
        </Field>
        <Field label="ISIN">
          <input name="isin" defaultValue={initial?.isin ?? ""} className={INPUT} />
        </Field>
        <Field label="Issue open">
          <input type="date" name="issueOpenDate" defaultValue={initial?.issueOpenDate ?? ""} className={INPUT} />
        </Field>
        <Field label="Issue close">
          <input type="date" name="issueCloseDate" defaultValue={initial?.issueCloseDate ?? ""} className={INPUT} />
        </Field>
        <Field label="IPO price (₹)">
          <input type="number" step="0.01" name="ipoPriceFinal" defaultValue={initial?.ipoPriceFinal ?? ""} className={INPUT} />
        </Field>
        <Field label="Issue size (₹ cr)">
          <input type="number" step="0.01" name="issueSizeCr" defaultValue={initial?.issueSizeCr ?? ""} className={INPUT} />
        </Field>
        <Field label="Anchor value (₹ cr)">
          <input type="number" step="0.01" name="anchorValueCr" defaultValue={initial?.anchorValueCr ?? ""} className={INPUT} />
        </Field>
        <Field label="Anchor qty (shares)">
          <input name="anchorQtyShares" defaultValue={initial?.anchorQtyShares ?? ""} className={INPUT} />
        </Field>
        <Field label="Registrar">
          <input name="registrar" defaultValue={initial?.registrar ?? ""} className={INPUT} />
        </Field>
        <Field label="Notes">
          <input name="notes" defaultValue={initial?.notes ?? ""} className={INPUT} />
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50"
        >
          {busy ? "Saving…" : initial ? "Save changes" : "Add IPO"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="rounded-md border border-border-strong px-3 py-1.5 text-xs">
            Cancel
          </button>
        )}
        <span className="text-[11px] text-fg-dim">
          Fields you fill here are marked as manual and will not be overwritten by sync.
        </span>
      </div>
    </form>
  );
}

const INPUT =
  "w-full rounded-md border border-border-strong bg-bg px-2 py-1.5 text-xs outline-none placeholder:text-fg-dim focus:border-accent";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-fg-muted">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-fg-dim">{hint}</span>}
    </label>
  );
}
