import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luxus Green Mobility",
  description: "Dealer onboarding, dealer management, warranty management, and landing-page intake for the Luxus Green Mobility dealer network.",
};

// Runs before paint so the page never flashes light-then-dark (or vice
// versa) on load. Light is the default — dark only applies if the user
// explicitly chose it last time (localStorage), never from OS preference,
// since this app is designed primarily around the light theme.
const THEME_INIT_SCRIPT = `
  try {
    if (localStorage.getItem("theme") === "dark") {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        {/* webp isn't a Next.js file-convention favicon extension (icon.ico/png/jpg/svg only) — linked manually instead */}
        <link rel="icon" type="image/webp" href="/luxus-green-logo.webp" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
