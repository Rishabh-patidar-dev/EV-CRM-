"use client";

// Persistent chrome strip above the page content — session, theme, and now
// (per the Innovun reference) a search field, an AI Copilot shortcut, and a
// notification bell. The bell's dot is real data (compliance alerts, the
// same figure the Overview page already fetches), not decorative.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Sparkles, Bell, LogOut } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import apiClient from "@/lib/api/client";

type SessionUser = { firstName: string; lastName: string | null; role: string };

const ROLE_LABEL: Record<string, string> = {
  SYSTEM_ADMIN: "System Admin",
  ADMIN: "Admin",
  NETWORK_EXPANSION: "Network Expansion",
  RELATIONSHIP_MANAGER: "Relationship Manager",
  SALES: "Sales",
  SUPPORT: "Support",
};

function initials(user: SessionUser) {
  const last = user.lastName?.[0] ?? "";
  return `${user.firstName[0] ?? ""}${last}`.toUpperCase() || "?";
}

export default function TopBar() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [alertCount, setAlertCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get("/api/v1/auth/me")
      .then((res) => {
        if (active) setUser(res.data.user);
      })
      .catch(() => {
        // Middleware already gates unauthenticated page loads — a failure
        // here just means an expired session; leave the name slot blank
        // rather than block the page on it.
      });
    apiClient
      .get("/api/v1/dealer-compliance/summary")
      .then((res) => {
        const byStatus = res.data?.byStatus ?? {};
        if (active) setAlertCount((byStatus.EXPIRED ?? 0) + (byStatus.EXPIRING_SOON ?? 0));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await apiClient.post("/api/v1/auth/logout");
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-card px-6"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5" style={{ backgroundColor: "var(--muted)" }}>
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search dealers, invoices, regions…"
          className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          disabled
          title="Search isn't wired to an index yet"
        />
        <kbd className="hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline" style={{ borderColor: "var(--border)" }}>
          ⌘K
        </kbd>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Link
          href="/ai-insights"
          className="hidden items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 sm:flex"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI Copilot
        </Link>

        <button
          title={alertCount ? `${alertCount} compliance alerts` : "No alerts"}
          className="relative flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {!!alertCount && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--zira-rejected)" }} />
          )}
        </button>

        <ThemeToggle />
        <div className="h-6 w-px bg-border" />
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {user ? initials(user) : "—"}
          </div>
          <div className="hidden leading-tight md:block">
            <div className="whitespace-nowrap text-sm font-medium">
              {user ? `${user.firstName} ${user.lastName ?? ""}`.trim() : "Loading…"}
            </div>
            <div className="whitespace-nowrap text-xs text-muted-foreground">
              {user ? (ROLE_LABEL[user.role] ?? user.role) : ""}
            </div>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title="Sign out"
            aria-label="Sign out"
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
