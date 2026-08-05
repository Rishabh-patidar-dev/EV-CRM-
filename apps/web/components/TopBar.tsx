"use client";

// Slim top bar above the page content — the structural piece the reference
// dashboard mock has and this app didn't: a persistent strip for chrome that
// doesn't belong to any one page (theme, current session). Deliberately
// doesn't carry a search bar, workspace switcher, or notification bell —
// this app has no search index, no multi-tenant workspaces, and no
// notification model to back those with real function.
import ThemeToggle from "./ThemeToggle";

export default function TopBar() {
  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-6"
      style={{ borderColor: "var(--border)" }}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Manufacturer Console
      </span>
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <div className="h-6 w-px bg-border" />
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            PS
          </div>
          <div className="leading-tight">
            <div className="whitespace-nowrap text-sm font-medium">Priya Sharma</div>
            <div className="whitespace-nowrap text-xs text-muted-foreground">System Admin</div>
          </div>
        </div>
      </div>
    </header>
  );
}
