"use client";

import { useState } from "react";

// Reads `?q=` once on mount and returns it as the initial value for a
// page's own search/filter state — how a GlobalSearch result (for a record
// type with no detail page of its own) actually finds its way to the
// matching row. Read via `window.location.search` rather than
// `useSearchParams()` so pages don't need a <Suspense> boundary just to
// consume this one param. Mirrors DMS's identical helper.
export function useDeepLinkQuery(): string {
  const [initial] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  return initial;
}
