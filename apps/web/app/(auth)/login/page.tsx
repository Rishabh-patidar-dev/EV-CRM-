import type { Metadata } from "next";
import ParticleNetwork from "@/components/auth/ParticleNetwork";
import LoginForm from "@/components/auth/LoginForm";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Sign in — EV Vikas",
};

const MODULES = [
  "Lead Master & Campaigns",
  "Dealer Onboarding",
  "Dealer Management",
  "Vehicle Inventory",
  "Warranty Management",
];

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel — flat near-black, no gradient/glow, one accent (teal). */}
      <div className="relative hidden overflow-hidden bg-[#0e1213] lg:flex lg:w-1/2 lg:flex-col lg:justify-between lg:p-14">
        <ParticleNetwork />

        <div className="relative z-10 flex items-center gap-2.5">
          <Logo className="h-6 w-6 text-[#35b5a3]" />
          <span className="text-[15px] font-semibold tracking-tight text-white">EV Vikas</span>
          <span className="ml-1 rounded-sm border border-white/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/50">
            Manufacturer Console
          </span>
        </div>

        <div className="relative z-10 max-w-md">
          <h1 className="text-[2.35rem] font-semibold leading-[1.12] tracking-tight text-white">
            Landing-page intake to
            <br />
            live network operations —
            <br />
            one console.
          </h1>
          <ul className="mt-8 space-y-2.5 border-l border-white/10 pl-4">
            {MODULES.map((m) => (
              <li key={m} className="text-sm text-white/55">
                {m}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 font-mono text-[11px] text-white/30">
          © 2026 EV Vikas · Internal use only
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center bg-background px-6 py-16">
        <div className="w-full max-w-[360px]">
          <div className="mb-9 flex items-center gap-2 lg:hidden">
            <Logo className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-foreground">EV Vikas</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Use your manufacturer console credentials.
            </p>
          </div>

          <LoginForm />
        </div>
      </div>
    </div>
  );
}
