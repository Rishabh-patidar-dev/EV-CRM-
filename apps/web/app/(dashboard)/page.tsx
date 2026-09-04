"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Workflow,
  Warehouse,
  ShieldCheck,
  UserSquare2,
  Megaphone,
  ShieldPlus,
  ListChecks,
  ShoppingCart,
  ArrowRight,
  AlertTriangle,
  Users2,
  MapPin,
  ClipboardList,
} from "lucide-react";
import apiClient from "@/lib/api/client";
import DonutChart from "@/components/charts/DonutChart";
import BarChart from "@/components/charts/BarChart";
import LineChart from "@/components/charts/LineChart";
import ChartCard from "@/components/charts/ChartCard";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import AIInsightsPanel, { type Insight } from "@/components/ui/AIInsightsPanel";

interface DealerStats {
  totalDealers: number;
  statesCovered: number;
  citiesCovered: number;
  outstandingReceivable: number;
  openServiceTickets: number;
  byStatus: Record<string, number>;
  byState: { state: string; count: number }[];
}

interface LeadStats {
  total: number;
  unassigned: number;
  byStatus: Record<string, number>;
  trend?: { weeks: string[]; series: { label: string; values: number[] }[] };
}

export default function DashboardPage() {
  const [dealerStats, setDealerStats] = useState<DealerStats | null>(null);
  const [onboardingBoard, setOnboardingBoard] = useState<{ stages: string[]; counts: Record<string, number> } | null>(null);
  const [complianceAlerts, setComplianceAlerts] = useState<number | null>(null);
  const [leadStats, setLeadStats] = useState<LeadStats | null>(null);
  const [warrantyPipeline, setWarrantyPipeline] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [stats, board, compliance, leads, warranty] = await Promise.allSettled([
          apiClient.get("/api/v1/dealers/stats"),
          apiClient.get("/api/v1/onboarding/board"),
          apiClient.get("/api/v1/dealer-compliance/summary"),
          apiClient.get("/api/v1/leads/stats"),
          apiClient.get("/api/v1/warranty-claims", { params: { limit: 1 } }),
        ]);
        if (!active) return;
        if (stats.status === "fulfilled") setDealerStats(stats.value.data);
        if (board.status === "fulfilled") setOnboardingBoard(board.value.data);
        if (compliance.status === "fulfilled") {
          const byStatus = compliance.value.data?.byStatus ?? {};
          setComplianceAlerts((byStatus.EXPIRED ?? 0) + (byStatus.EXPIRING_SOON ?? 0));
        }
        if (leads.status === "fulfilled") setLeadStats(leads.value.data);
        if (warranty.status === "fulfilled") setWarrantyPipeline(warranty.value.data?.pipeline ?? {});
      } catch {
        // dashboard is best-effort — module pages surface real errors
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onboardingTotal = onboardingBoard ? Object.values(onboardingBoard.counts).reduce((a, b) => a + b, 0) : null;

  // "+X% vs prior period" — last 4 of the 8 tracked weeks vs. the 4 before
  // that, summed across all lead sources. Real arithmetic over the trend
  // endpoint's actual weekly buckets, not a display-only figure.
  let leadTrendPct: number | null = null;
  if (leadStats?.trend) {
    const totals = leadStats.trend.weeks.map((_, i) => leadStats.trend!.series.reduce((sum, s) => sum + s.values[i], 0));
    const prior = totals.slice(0, 4).reduce((a, b) => a + b, 0);
    const recent = totals.slice(4).reduce((a, b) => a + b, 0);
    leadTrendPct = prior > 0 ? Math.round(((recent - prior) / prior) * 100) : recent > 0 ? 100 : null;
  }

  // Rule-based reads over the same numbers already on this page — see
  // AIInsightsPanel's note on why there's no fabricated confidence score.
  const insights: Insight[] = [];
  if (leadTrendPct != null && leadTrendPct <= -10) {
    insights.push({
      title: `Lead volume down ${Math.abs(leadTrendPct)}%`,
      detail: "Last 4 weeks vs. the 4 before that, across all sources.",
      tone: "rejected",
      href: "/leads",
    });
  } else if (leadTrendPct != null && leadTrendPct >= 10) {
    insights.push({
      title: `Lead volume up ${leadTrendPct}%`,
      detail: "Last 4 weeks vs. the 4 before that, across all sources.",
      tone: "approved",
      href: "/leads",
    });
  }
  if (leadStats && leadStats.unassigned > 0) {
    insights.push({
      title: `${leadStats.unassigned} lead${leadStats.unassigned === 1 ? "" : "s"} unassigned`,
      detail: "Sitting without an owner in the routing queue.",
      tone: "pending",
      href: "/leads/unassigned",
    });
  }
  if (onboardingBoard) {
    const activeStages = onboardingBoard.stages.filter((s) => s !== "OPERATIONAL");
    const bottleneck = activeStages
      .map((s) => ({ stage: s, count: onboardingBoard.counts[s] ?? 0 }))
      .sort((a, b) => b.count - a.count)[0];
    if (bottleneck && bottleneck.count > 0) {
      insights.push({
        title: `${bottleneck.count} application${bottleneck.count === 1 ? "" : "s"} at ${bottleneck.stage.replace(/_/g, " ")}`,
        detail: "The largest single stage in the onboarding pipeline right now.",
        tone: "info",
        href: "/dealer-onboarding",
      });
    }
  }
  if (complianceAlerts != null && complianceAlerts > 0) {
    insights.push({
      title: `${complianceAlerts} compliance document${complianceAlerts === 1 ? "" : "s"} need attention`,
      detail: "Expired or expiring within 30 days.",
      tone: "pending",
      href: "/dealer-compliance",
    });
  }

  return (
    <div className="mx-auto max-w-[1500px] p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Luxus Green Mobility</h1>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard tone="blue" icon={<Users2 className="h-3.5 w-3.5" />} label="Leads" value={leadStats?.total ?? "—"} />
        <StatCard tone="amber" icon={<ClipboardList className="h-3.5 w-3.5" />} label="Unassigned leads" value={leadStats?.unassigned ?? "—"} />
        <StatCard tone="green" icon={<Building2 className="h-3.5 w-3.5" />} label="Active dealers" value={dealerStats?.totalDealers ?? "—"} />
        <StatCard tone="purple" icon={<MapPin className="h-3.5 w-3.5" />} label="Cities covered" value={dealerStats?.citiesCovered ?? "—"} />
        <StatCard tone="blue" icon={<Workflow className="h-3.5 w-3.5" />} label="Applications in pipeline" value={onboardingTotal ?? "—"} />
        <StatCard tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Compliance alerts" value={complianceAlerts ?? "—"} />
      </section>

      {/* ---- lead volume trend + AI insights ---- */}
      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <ChartCard
          title="Lead volume by source"
          subtitle="Weekly new leads, last 8 weeks"
          trend={leadTrendPct != null ? `${leadTrendPct >= 0 ? "+" : ""}${leadTrendPct}% vs prior 4 weeks` : undefined}
          trendDirection={leadTrendPct != null && leadTrendPct < 0 ? "down" : "up"}
        >
          {leadStats?.trend ? (
            <LineChart labels={leadStats.trend.weeks} series={leadStats.trend.series} />
          ) : (
            <ChartSkeleton />
          )}
        </ChartCard>

        <AIInsightsPanel insights={insights} />
      </section>

      {/* ---- BI figures ---- */}
      {/* Two columns (not three) so each donut's legend has room for full
          status names ("UNDER_REVIEW", "UNQUALIFIED", ...) instead of
          truncating mid-word. */}
      <section className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Leads by status">
          {leadStats ? (
            <DonutChart
              data={["OPEN", "WORKING", "QUALIFIED", "NURTURING", "UNQUALIFIED", "CONVERTED"].map((s) => ({ label: s.replace("_", " "), value: leadStats.byStatus?.[s] ?? 0 }))}
              centerLabel="leads"
            />
          ) : <ChartSkeleton />}
        </ChartCard>

        <ChartCard title="Dealer network by status">
          {dealerStats ? (
            <DonutChart
              data={["ACTIVE", "ONBOARDING", "ON_HOLD", "SUSPENDED", "TERMINATED"].map((s) => ({ label: s.replace("_", " "), value: dealerStats.byStatus?.[s] ?? 0 }))}
              centerLabel="dealers"
            />
          ) : <ChartSkeleton />}
        </ChartCard>

        <ChartCard title="Warranty claims by status">
          <DonutChart
            data={["SUBMITTED", "UNDER_REVIEW", "APPROVED", "IN_REPAIR", "REIMBURSED", "RECOVERY", "REJECTED", "CLOSED"].map((s) => ({ label: s.replace("_", " "), value: warrantyPipeline[s] ?? 0 }))}
            centerLabel="claims"
          />
        </ChartCard>

        <ChartCard title="Onboarding pipeline by stage">
          {onboardingBoard ? (
            <BarChart color="var(--viz-2)" data={onboardingBoard.stages.filter((s) => s !== "OPERATIONAL").map((s) => ({ label: s.replace(/_/g, " "), value: onboardingBoard.counts[s] ?? 0 }))} />
          ) : <ChartSkeleton />}
        </ChartCard>
      </section>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Modules</h2>
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ModuleCard href="/leads" icon={<UserSquare2 className="h-5 w-5" />} title="Lead Master" description="Retail enquiries from the landing page and manual entry, scored and worked to a sale." />
        <ModuleCard href="/landing-page-campaigns" icon={<Megaphone className="h-5 w-5" />} title="Campaigns" description="The webhook + GTM contract with the external landing page — one unique ID per campaign." />
        <ModuleCard href="/dealer-onboarding" icon={<Workflow className="h-5 w-5" />} title="Dealer Onboarding" description="5-stage pipeline from application to Letter of Intent, with per-stage document verification." />
        <ModuleCard href="/dealer-management" icon={<Building2 className="h-5 w-5" />} title="Dealer Management" description="Territory, targets vs. actuals, lead routing, finance, and OEM<->dealer orders — one 360 view." />
        <ModuleCard href="/inventory-management/vehicles" icon={<Warehouse className="h-5 w-5" />} title="Vehicle Inventory" description="VIN-level stock from OEM warehouse through allocation, demo fleet, and sale, plus a BI dashboard." />
        <ModuleCard href="/order-management" icon={<ListChecks className="h-5 w-5" />} title="Order Management" description="Every vehicle-stock and spare-part order across the whole dealer network — aging, fulfillment, top dealers." />
        <ModuleCard href="/purchase-management" icon={<ShoppingCart className="h-5 w-5" />} title="Purchase Management" description="The manufacturer's own inbound stock — purchase orders in, vehicles sold, by model." />
        <ModuleCard href="/dealer-compliance" icon={<ShieldCheck className="h-5 w-5" />} title="Compliance & Renewals" description="Dealer agreements, licenses, insurance and NOCs with expiry tracking." />
        <ModuleCard href="/warranty" icon={<ShieldPlus className="h-5 w-5" />} title="Warranty Management" description="Serial-level coverage, dealer claim intake, auto-adjudication, reimbursement, supplier recovery." />
      </section>

      {complianceAlerts != null && complianceAlerts > 0 && (
        <Card padding="compact" className="mt-6 flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--zira-pending)" }} />
          <span>
            {complianceAlerts} dealer compliance document{complianceAlerts === 1 ? "" : "s"} expired or expiring soon —{" "}
            <Link href="/dealer-compliance" className="font-medium text-primary hover:underline">
              review renewals
            </Link>
            .
          </span>
        </Card>
      )}
    </div>
  );
}

function ChartSkeleton() {
  return <div className="flex h-[168px] items-center justify-center text-xs text-muted-foreground">Loading…</div>;
}

function ModuleCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col justify-between rounded-[var(--radius)] border border-border bg-card p-5 transition-colors hover:bg-accent"
    >
      <div>
        <div className="mb-3 inline-flex items-center justify-center rounded-md bg-primary/10 p-2 text-primary">
          {icon}
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="mt-4 flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        Open <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}
