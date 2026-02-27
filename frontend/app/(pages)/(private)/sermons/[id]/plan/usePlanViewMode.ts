import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";

import type { PlanViewMode } from "./types";

/**
 * Hook to manage plan view mode state via query parameters.
 * Supports: overlay, immersive, preaching.
 */
export default function usePlanViewMode() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const planViewParam = searchParams.get("planView");

  const mode = useMemo<PlanViewMode | null>(() => {
    if (
      planViewParam === "overlay" ||
      planViewParam === "immersive" ||
      planViewParam === "preaching"
    ) {
      return planViewParam;
    }
    return null;
  }, [planViewParam]);

  const updateMode = useCallback(
    (newMode: PlanViewMode | null, { replace = true }: { replace?: boolean } = {}) => {
      if (!pathname) return;

      const paramsCopy = new URLSearchParams(searchParams.toString());
      if (newMode) {
        paramsCopy.set("planView", newMode);
      } else {
        paramsCopy.delete("planView");
      }

      const query = paramsCopy.toString();
      const targetUrl = query ? `${pathname}?${query}` : pathname;

      if (replace) {
        router.replace(targetUrl, { scroll: false });
      } else {
        router.push(targetUrl, { scroll: false });
      }
    },
    [pathname, router, searchParams]
  );

  const openOverlay = useCallback(() => updateMode("overlay"), [updateMode]);
  const openImmersive = useCallback(() => updateMode("immersive"), [updateMode]);
  const openPreaching = useCallback(
    () => updateMode("preaching", { replace: false }),
    [updateMode]
  );
  const close = useCallback(() => updateMode(null), [updateMode]);

  return {
    mode,
    openOverlay,
    openImmersive,
    openPreaching,
    close,
    isOverlay: mode === "overlay",
    isImmersive: mode === "immersive",
    isPreaching: mode === "preaching",
  };
}
