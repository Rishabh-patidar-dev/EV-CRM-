// EV CRM mark — a single mark reads as both letters at once: the left arm
// is a plain diagonal (the "V" of Vikas / growth), the right arm carries a
// lightning-bolt kink partway down (the "EV" of electric vehicle), and both
// arms land on the same base point. Drawn as plain strokes, not a bolt-only
// icon, so it stays legible at 16px (favicon) through 32px (sidebar badge).
import type { CSSProperties } from "react";

export default function Logo({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 32 32" className={className} style={style} role="img" aria-label="EV CRM">
      <path
        d="M9 8 L16 24 M23 8 L17 15 L21 15 L15 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
