import React from "react";

// One shared button — replaces the hand-rolled <button className="..."> markup
// scattered per page (each with its own slightly different padding/radius/
// hover treatment). Four variants cover every case found across the app;
// transitions are Tailwind's built-in transition-colors only, matching the
// app's existing animation-light baseline (no new library, no layout-thrashing
// effects).
type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border text-foreground hover:bg-accent",
  ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  destructive:
    "border border-[color:var(--zira-rejected)]/40 text-[color:var(--zira-rejected)] hover:bg-[color:var(--zira-rejected)]/10",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2.5 text-sm gap-2",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(({ variant = "primary", size = "md", className = "", children, ...props }, ref) => (
  <button
    ref={ref}
    className={`inline-flex shrink-0 items-center justify-center rounded-[var(--radius)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
    {...props}
  >
    {children}
  </button>
));
Button.displayName = "Button";
