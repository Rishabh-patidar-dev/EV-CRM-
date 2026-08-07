import type { Metadata } from "next";
import WaveBackdrop from "@/components/auth/WaveBackdrop";
import LanguageSwitcher from "@/components/auth/LanguageSwitcher";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in — VoltOs",
};

const STATS = [
  { label: "OCR ACCURACY", value: "99.9%" },
  { label: "DEALER COVERAGE", value: "100% Connected" },
  { label: "DATA SYNC RATE", value: "Live Feed" },
];

export default function LoginPage() {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-between lg:p-14" style={{ backgroundColor: "var(--accent)" }}>
        <WaveBackdrop />

        <div className="relative z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/innovun-dark.png" alt="Innovun" className="h-8 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/innovun-light.png" alt="Innovun" className="hidden h-8 w-auto dark:block" />
        </div>

        <div className="relative z-10 max-w-lg">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
            AI-Powered Channel Intelligence
          </span>
          <div className="mt-2 h-0.5 w-10 bg-primary" />

          <h1 className="mt-6 text-5xl font-bold leading-[1.08] tracking-tight text-foreground">
            Every dealer.
            <br />
            Every invoice.
            <br />
            <span className="text-primary">One line of sight.</span>
          </h1>

          <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
            AI-read invoices, live KPIs and slab forecasts across every region — so
            decisions happen in seconds, not at month-end.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-md border bg-card px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <p className="mt-0.5 text-base font-bold text-foreground">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-bold text-primary-foreground" style={{ backgroundColor: "var(--primary)" }}>
            I
          </span>
          <p className="text-xs text-muted-foreground">Powered By Innovun Global</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col bg-background">
        <div className="flex justify-end p-6">
          <LanguageSwitcher />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-[380px]">
            <div className="mb-8 lg:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/innovun-dark.png" alt="Innovun" className="h-7 w-auto dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/innovun-light.png" alt="Innovun" className="hidden h-7 w-auto dark:block" />
            </div>

            <div className="mb-8">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">Welcome back</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your analytics workspace</p>
              <div className="mt-3 h-0.5 w-10 bg-primary" />
            </div>

            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
