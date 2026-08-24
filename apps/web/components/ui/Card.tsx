import React from "react";

// Thin wrapper around the existing .card-elevated utility — the fix isn't a
// new visual style, it's settling on ONE padding per card "size class"
// instead of every page hand-typing p-3/p-4/p-5/p-6 for what's visually the
// same section-card pattern. `compact` matches StatCard's existing p-4
// convention; `default` matches the more common section/panel padding.
export function Card({
  padding = "default",
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { padding?: "default" | "compact" }) {
  const pad = padding === "compact" ? "p-4" : "p-5";
  return (
    <div className={`card-elevated ${pad} ${className}`} {...props}>
      {children}
    </div>
  );
}
