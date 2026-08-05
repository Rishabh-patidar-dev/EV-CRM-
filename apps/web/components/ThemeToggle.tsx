"use client";

// Reads/writes localStorage("theme"); the blocking script in layout.tsx sets
// the initial `.dark` class before paint so there's no flash. Light is the
// default the app is designed around — dark is supported, not primary.
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setIsDark(next);
  };

  return (
    <button
      onClick={toggle}
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      {isDark ? "Light theme" : "Dark theme"}
    </button>
  );
}
