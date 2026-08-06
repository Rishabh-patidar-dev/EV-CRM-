"use client";

// Slim top bar above the page content — the structural piece the reference
// dashboard mock has and this app didn't: a persistent strip for chrome that
// doesn't belong to any one page (theme, current session). Deliberately
// doesn't carry a search bar, workspace switcher, or notification bell —
// this app has no search index, no multi-tenant workspaces, and no
// notification model to back those with real function.
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
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
            {user ? initials(user) : "—"}
          </div>
          <div className="leading-tight">
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
