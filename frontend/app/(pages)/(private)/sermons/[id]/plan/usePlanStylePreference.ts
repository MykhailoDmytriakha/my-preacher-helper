"use client";

import { useCallback, useEffect, useState } from "react";

import type { PlanStyle } from "@/api/clients/planTypes";

/**
 * HOW LONG THE PREACHER LIKES HIS CUE SHEETS — one setting, remembered, shared by both editors.
 *
 * Each plan screen used to hold its own `useState('memory')`, and the from-a-note workspace
 * remounts by key, so the setting reset to Short on every entry and the two editors could sit
 * on different volumes at once. Someone who picked Detailed, left and came back got a short
 * plan with nothing on screen explaining why.
 *
 * This is a preference about the person, not about one sermon, and it costs nothing to be
 * wrong about: kept in this browser, not on the server. Storage can refuse (a private window,
 * blocked site data), and then the default simply stands.
 */
const STORAGE_KEY = "planStylePreference";

const isPlanStyle = (value: unknown): value is PlanStyle =>
  value === "memory" || value === "narrative" || value === "exegetical";

export function usePlanStylePreference(): [PlanStyle, (style: PlanStyle) => void] {
  // Starts at the default and adopts storage after mount: reading during render would make
  // the server-rendered markup disagree with the first client paint.
  const [style, setStyleState] = useState<PlanStyle>("memory");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isPlanStyle(stored)) setStyleState(stored);
    } catch {
      // Storage refused — the default is a perfectly good answer.
    }
  }, []);

  const setStyle = useCallback((next: PlanStyle) => {
    setStyleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies to this screen; it just will not outlive it.
    }
  }, []);

  return [style, setStyle];
}
