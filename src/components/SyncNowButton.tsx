"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Triggers the same ingestion route the daily cron calls. */
export function SyncNowButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState("busy");
    setMessage(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        rowsAdded?: number;
        rowsUpdated?: number;
        error?: string;
      };
      if (!res.ok) {
        setState("error");
        setMessage(body.error ?? `Sync failed (${res.status})`);
        return;
      }
      setState("done");
      setMessage(`+${body.rowsAdded ?? 0} new, ${body.rowsUpdated ?? 0} updated`);
      router.refresh();
    } catch {
      setState("error");
      setMessage("Network error");
    } finally {
      setTimeout(() => setState((s) => (s === "busy" ? "idle" : s)), 500);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={state === "busy"}
        className="rounded-md border border-border-strong px-2 py-1 text-xs text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {state === "busy" ? "Syncing…" : "Sync now"}
      </button>
      {message && (
        <span className={state === "error" ? "text-danger" : "text-fg-dim"}>{message}</span>
      )}
    </span>
  );
}
