"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  AlertTriangle,
  FileText,
} from "lucide-react";
import Logo from "./Logo";

type NavIcon = React.ComponentType<{ className?: string }>;
// `exactOnly` is for nav items whose href has sibling static routes that
// aren't "detail views" of it (e.g. /leads vs /leads/assigned) — without it,
// the prefix-match below would highlight Lead Master while on Assigned Leads.
type NavItem = { href: string; label: string; icon: NavIcon; badge?: string; badgeTone?: "new" | "dev"; exactOnly?: boolean };
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
      { href: "/dealer-inventory", label: "Vehicle Inventory", icon: Warehouse },
      { href: "/order-management", label: "Order Management", icon: ListChecks, exactOnly: true },
      { href: "/order-management/disputed", label: "Disputed Orders", icon: AlertTriangle },
      { href: "/order-management/invoices", label: "Invoices", icon: FileText },
      { href: "/purchase-management", label: "Purchase Management", icon: ShoppingCart, badge: "new" },
      { href: "/dealer-compliance", label: "Compliance & Renewals", icon: ShieldCheck },
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

const DEFAULT_OPEN = new Set(["leads", "campaigns", "dealer", "warranty", "intelligence"]);

export default function Sidebar() {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<Set<string>>(DEFAULT_OPEN);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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
            <SidebarLink key={entry.href} {...entry} active={pathname === entry.href} />
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

function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
  badgeTone,
}: NavItem & { active?: boolean }) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${active ? "sidebar-active" : ""}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate flex-1">{label}</span>
      {badge && badgeTone === "dev" ? (
        <span className="flex shrink-0 items-center gap-1.5" title="Under development">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--zira-rejected)]" />
        </span>
      ) : badge ? (
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
      ) : null}
    </Link>
  );
}
