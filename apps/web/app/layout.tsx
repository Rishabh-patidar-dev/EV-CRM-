import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";

export const metadata: Metadata = {
  title: "EV Vikas",
  description: "Dealer onboarding, dealer management, warranty management, and landing-page intake for the EV Vikas dealer network.",
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
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full">
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <TopBar />
            <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
