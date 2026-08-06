"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, ArrowRight, ShieldCheck } from "lucide-react";

export default function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, remember }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || "Something went wrong. Try again.");
        setSubmitting(false);
        return;
      }
      // Full navigation, not router.push — the (dashboard) layout and every
      // page under it read session state fresh on load; a client-side
      // transition would carry over the pre-login render.
      window.location.href = "/";
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && (
        <div
          className="rounded-[var(--radius)] border px-3.5 py-2.5 text-sm"
          style={{ borderColor: "var(--destructive)", backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)", color: "var(--destructive)" }}
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          className="rounded-[var(--radius)] border px-3.5 py-2.5 text-sm"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {notice}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="username" className="text-sm font-medium text-foreground">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Admin"
          className="w-full rounded-[var(--radius)] px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[var(--ring)]"
          style={{ backgroundColor: "var(--muted)", border: "1px solid transparent" }}
          required
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Password
          </label>
        </div>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••"
            className="w-full rounded-[var(--radius)] px-3.5 py-2.5 pr-10 text-sm outline-none transition-colors focus:border-[var(--ring)]"
            style={{ backgroundColor: "var(--muted)", border: "1px solid transparent" }}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-3.5 w-3.5 rounded-sm accent-[var(--primary)]"
          />
          Keep me signed in
        </label>
        <button
          type="button"
          onClick={() => setNotice("Password resets aren't self-serve yet — contact your administrator.")}
          className="text-sm font-medium text-primary hover:underline"
        >
          Forgot password?
        </button>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
        {!submitting && <ArrowRight className="h-3.5 w-3.5" />}
      </button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1" style={{ backgroundColor: "var(--border)" }} />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1" style={{ backgroundColor: "var(--border)" }} />
      </div>

      <button
        type="button"
        onClick={() => setNotice("Enterprise SSO isn't configured for this environment yet.")}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius)] border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        style={{ borderColor: "var(--border)" }}
      >
        <ShieldCheck className="h-4 w-4" />
        Continue with enterprise SSO
      </button>

      <p className="text-center text-xs text-muted-foreground">
        Role-based access &middot; Field-level data masking &middot; Encrypted session
      </p>
    </form>
  );
}
