// Decorative background for the login brand panel — a few soft overlapping
// sine waves, matching the reference's subtle line-pattern treatment.
// Pure inline SVG, no assets to fetch.
export default function WaveBackdrop() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 600 900"
      preserveAspectRatio="xMidYMid slice"
    >
      <g stroke="var(--primary)" strokeWidth="1" fill="none" opacity="0.12">
        <path d="M-50,300 C100,260 200,340 350,300 S600,260 700,300" />
        <path d="M-50,380 C100,340 200,420 350,380 S600,340 700,380" />
        <path d="M-50,460 C100,420 200,500 350,460 S600,420 700,460" />
        <path d="M-50,540 C100,500 200,580 350,540 S600,500 700,540" />
        <path d="M-50,620 C100,580 200,660 350,620 S600,580 700,620" />
      </g>
    </svg>
  );
}
