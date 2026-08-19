import type { CSSProperties } from "react";

export default function Logo({ className, style }: { className?: string; style?: CSSProperties }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/luxus-green-logo.webp" alt="Luxus Green Mobility" className={className} style={{ objectFit: "contain", ...style }} />;
}
