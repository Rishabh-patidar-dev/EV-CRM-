"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import apiClient from "@/lib/api/client";
import { ORDER_MGMT_LAST_SEEN_KEY } from "./orderManagementSeen";
import { INVOICE_LAST_SEEN_KEY } from "./invoicesSeen";
import {
  LayoutDashboard,
  Workflow,
  Building2,
  Warehouse,
  ShieldCheck,
  UserSquare2,
  UserCheck,
  Share2,
  Megaphone,
  ChevronDown,
  ShieldPlus,
  ListChecks,
  Sparkles,
  ShoppingCart,
  Mail,
  MessageCircle,
  CheckSquare,
  FileText,
  Receipt,
  PackageSearch,
  ScrollText,
  Landmark,
} from "lucide-react";
import Logo from "./Logo";

type NavIcon = React.ComponentType<{ className?: string }>;
// `exactOnly` is for nav items whose href has sibling static routes that
// aren't "detail views" of it (e.g. /leads vs /leads/assigned) — without it,
// the prefix-match below would highlight Lead Master while on Assigned Leads.
// `asModule` renders a top-level single-page link with the same flat
// uppercase typography as a collapsed group header (no icon, no filled
// pill) instead of the icon+pill treatment used for links nested inside a
// group — a standalone module (one page, no sub-items) still reads as a
// section of the sidebar, not a stray sub-item, this way. Overview keeps the
// pill treatment since it's the app's home link, not a module.
type NavItem = { href: string; label: string; icon: NavIcon; badge?: string; badgeTone?: "new" | "dev"; exactOnly?: boolean; asModule?: boolean };
type NavEntry = ({ kind: "link" } & NavItem) | { kind: "group"; id: string; group: string; items: NavItem[] };

const NAV: NavEntry[] = [
  { kind: "link", href: "/", label: "Overview", icon: LayoutDashboard },
  {
    kind: "group",
    id: "leads",
    group: "Lead Management",
    items: [
      { href: "/leads", label: "Lead Master", icon: UserSquare2, exactOnly: true },
      { href: "/leads/assigned", label: "Assigned Leads", icon: UserCheck },
      { href: "/leads/unassigned", label: "Unassigned Leads", icon: Share2 },
    ],
  },
  {
    kind: "group",
    id: "campaigns",
    group: "Campaign Management",
    items: [
      { href: "/landing-page-campaigns", label: "Landing Page Campaigns", icon: Megaphone },
      { href: "/campaign-management/email", label: "Email Campaigns", icon: Mail },
      { href: "/campaign-management/whatsapp", label: "WhatsApp Campaigns", icon: MessageCircle },
      { href: "/campaign-management/segments", label: "Segments", icon: CheckSquare },
    ],
  },
  {
    kind: "group",
    id: "dealer",
    group: "Dealer Management",
    items: [
      { href: "/dealer-onboarding", label: "Onboarding Pipeline", icon: Workflow },
      { href: "/dealer-management", label: "Dealer 360", icon: Building2 },
      { href: "/purchase-management", label: "Purchase Management", icon: ShoppingCart, badge: "new" },
      { href: "/dealer-compliance", label: "Compliance & Renewals", icon: ShieldCheck },
    ],
  },
  { kind: "link", href: "/order-management", label: "Order Management", icon: ListChecks, asModule: true },
  { kind: "link", href: "/invoices", label: "Invoices", icon: FileText, asModule: true },
  { kind: "link", href: "/finance-management", label: "Finance Management", icon: Landmark, asModule: true },
  {
    kind: "group",
    id: "inventory-management",
    group: "Inventory Management",
    items: [
      { href: "/inventory-management/vehicles", label: "Vehicle Inventory", icon: Warehouse },
      { href: "/inventory-management/spare-parts", label: "Spare Parts Inventory", icon: PackageSearch },
      { href: "/inventory-management/logs", label: "Inventory Logs", icon: ScrollText },
    ],
  },
  {
    kind: "group",
    id: "warranty",
    group: "Warranty Management",
    items: [
      { href: "/warranty", label: "Claims & Coverage", icon: ShieldPlus },
    ],
  },
  {
    kind: "group",
    id: "intelligence",
    group: "Intelligence",
    items: [
      { href: "/ai-insights", label: "AI Insights", icon: Sparkles, badge: "dev", badgeTone: "dev", exactOnly: true },
    ],
  },
];

// All groups start collapsed — a group only opens once the user actually
// clicks it, rather than pre-guessing which one they'll want.
const DEFAULT_OPEN = new Set<string>();

export default function Sidebar() {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<Set<string>>(DEFAULT_OPEN);
  const [newOrderMarker, setNewOrderMarker] = useState(false);
  const [invoiceUnreadCount, setInvoiceUnreadCount] = useState(0);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Re-checks on every route change (not just mount) — Sidebar persists
  // across navigation within the dashboard shell, so this is the only
  // moment it can notice the order-management page just cleared the
  // localStorage "last seen" marker (see order-management/page.tsx).
  useEffect(() => {
    let active = true;
    apiClient
      .get("/api/v1/order-management/new-count")
      .then(({ data }) => {
        if (!active) return;
        const latest = data?.latestCreatedAt;
        if (!latest) return setNewOrderMarker(false);
        let lastSeen: string | null = null;
        try {
          lastSeen = localStorage.getItem(ORDER_MGMT_LAST_SEEN_KEY);
        } catch {
          // private-mode/unavailable storage — treat as never seen
        }
        setNewOrderMarker(!lastSeen || new Date(latest) > new Date(lastSeen));
      })
      .catch(() => {
        // non-critical UI indicator — a failed check just leaves it as-is
      });
    return () => { active = false; };
  }, [pathname]);

  // Same re-check-on-route-change reasoning as above, for the Invoices
  // "unread" badge — the endpoint itself computes the count relative to
  // `since`, so no client-side comparison is needed here.
  useEffect(() => {
    let active = true;
    let since = "";
    try {
      since = localStorage.getItem(INVOICE_LAST_SEEN_KEY) ?? "";
    } catch {
      // private-mode/unavailable storage — treat as never seen
    }
    apiClient
      .get("/api/v1/order-management/invoices/new-count", { params: since ? { since } : {} })
      .then(({ data }) => {
        if (active) setInvoiceUnreadCount(data?.count ?? 0);
      })
      .catch(() => {
        // non-critical UI indicator — a failed check just leaves it as-is
      });
    return () => { active = false; };
  }, [pathname]);

  return (
    <aside className="synkro-sidebar flex w-72 shrink-0 flex-col border-r">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b" style={{ borderColor: "var(--sidebar-border)" }}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white">
          <Logo className="h-9 w-9" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold leading-none tracking-tight">Luxus Green</div>
          <div className="sidebar-muted mt-1 truncate text-[11px] leading-none">Mobility</div>
        </div>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-3">
        {NAV.map((entry, i) =>
          entry.kind === "link" ? (
            <div key={entry.href} className={entry.asModule ? "mt-1 mb-1" : undefined}>
              <SidebarLink
                {...entry}
                active={pathname === entry.href}
                liveIndicator={entry.href === "/order-management" && newOrderMarker}
                badgeCount={entry.href === "/invoices" ? invoiceUnreadCount : undefined}
              />
            </div>
          ) : (
            <div key={entry.id ?? i} className="mt-1 mb-1">
              <button
                onClick={() => toggleGroup(entry.id)}
                className="sidebar-muted flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide"
              >
                <span>{entry.group}</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openGroups.has(entry.id) ? "" : "-rotate-90"}`} />
              </button>
              {openGroups.has(entry.id) && (
                <div className="flex flex-col gap-0.5">
                  {entry.items.map((item) => (
                    <SidebarLink
                      key={item.href}
                      {...item}
                      active={pathname === item.href || (!item.exactOnly && !!pathname?.startsWith(item.href + "/"))}
                      liveIndicator={item.href === "/order-management" && newOrderMarker}
                      badgeCount={item.href === "/order-management/invoices" ? invoiceUnreadCount : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </nav>

      <div className="border-t px-5 py-4" style={{ borderColor: "var(--sidebar-border)" }}>
        <p className="sidebar-muted text-[11px]">© {new Date().getFullYear()} Luxus Green Mobility</p>
      </div>
    </aside>
  );
}

function SidebarIndicator({
  active,
  badge,
  badgeTone,
  liveIndicator,
  badgeCount,
}: { active?: boolean; badge?: string; badgeTone?: "new" | "dev"; liveIndicator?: boolean; badgeCount?: number }) {
  if (badgeCount) {
    return (
      <span
        className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold tabular-nums text-white"
        title={`${badgeCount} invoice${badgeCount === 1 ? "" : "s"} not yet reviewed`}
      >
        {badgeCount > 99 ? "99+" : badgeCount}
      </span>
    );
  }
  if (liveIndicator) {
    return (
      <span className="shrink-0 text-base font-bold leading-none" style={{ color: "var(--zira-approved)" }} title="New order placed by a dealer — not yet checked">
        *
      </span>
    );
  }
  if (badge && badgeTone === "dev") {
    return (
      <span className="flex shrink-0 items-center gap-1.5" title="Under development">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--zira-rejected)]" />
      </span>
    );
  }
  if (badge) {
    return (
      <span
        className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
        style={
          active
            ? { background: "var(--sidebar-primary-foreground)", color: "var(--sidebar-primary)" }
            : { background: "var(--sidebar-primary)", color: "var(--sidebar-primary-foreground)" }
        }
      >
        {badge}
      </span>
    );
  }
  return null;
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
  badgeTone,
  liveIndicator,
  badgeCount,
  asModule,
}: NavItem & { active?: boolean; liveIndicator?: boolean; badgeCount?: number }) {
  // A standalone one-page module (Order Management, Invoices, Finance
  // Management) sits at the same level as a group header ("LEAD
  // MANAGEMENT") in the nav list — matching that header's flat uppercase
  // typography (no icon, no filled pill, same trailing chevron even though
  // there's nothing to expand) is what makes it read as another section of
  // the sidebar instead of a stray sub-item link.
  if (asModule) {
    return (
      <Link
        href={href}
        className={`flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors ${active ? "" : "sidebar-muted hover:text-[color:var(--sidebar-foreground)]"}`}
        style={active ? { color: "var(--sidebar-primary)" } : undefined}
      >
        <span>{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <SidebarIndicator active={active} badge={badge} badgeTone={badgeTone} liveIndicator={liveIndicator} badgeCount={badgeCount} />
          <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${active ? "sidebar-active" : ""}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate flex-1">{label}</span>
      <SidebarIndicator active={active} badge={badge} badgeTone={badgeTone} liveIndicator={liveIndicator} badgeCount={badgeCount} />
    </Link>
  );
}
