"use client";

export const THEME_STORAGE_KEY = "ipo-theme";

/**
 * Light/dark switch.
 *
 * Deliberately holds no React state: the current theme lives on <html data-theme>,
 * set before first paint by the inline script in layout.tsx. Mirroring it into state
 * would mean either a hydration mismatch or a setState-in-effect, and the label can
 * be driven entirely by CSS instead (see .theme-dark-only / .theme-light-only).
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing can block storage; the theme still applies for this page.
    }
  }

  return (
    <button
      onClick={toggle}
      title="Toggle light / dark theme"
      aria-label="Toggle light or dark theme"
      className="rounded-md border border-border-strong px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <span className="theme-dark-only">Light</span>
      <span className="theme-light-only">Dark</span>
    </button>
  );
}
