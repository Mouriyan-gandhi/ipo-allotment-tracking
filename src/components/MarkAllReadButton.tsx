"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkAllReadButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => null);
        router.refresh();
        setBusy(false);
      }}
      className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
    >
      {busy ? "Marking…" : "Mark all read"}
    </button>
  );
}
