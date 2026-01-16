"use client";

import { useCallback, useEffect, useState } from "react";

import { isDebugModeEnabled, setDebugModeEnabled } from "@/utils/debugMode";

export function useDebugMode() {
  const [enabled, setEnabled] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    const initial = isDebugModeEnabled();
    setEnabled(initial);
    setHasLoaded(true);
  }, []);

  const update = useCallback((nextValue: boolean) => {
    setEnabled(nextValue);
    setDebugModeEnabled(nextValue);
  }, []);

  return { enabled, setEnabled: update, hasLoaded };
}
