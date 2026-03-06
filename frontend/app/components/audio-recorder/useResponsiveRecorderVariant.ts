import { useEffect, useMemo, useState } from "react";

import { MOBILE_MAX_WIDTH } from "./constants";

import type { RecorderVariant } from "./types";

export function useResponsiveRecorderVariant(variant: RecorderVariant): RecorderVariant {
  const [isMobileView, setIsMobileView] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia === "function") {
      const mediaQuery = window.matchMedia("(max-width: 767px)");
      const updateIsMobile = (event: MediaQueryList | MediaQueryListEvent) => {
        setIsMobileView(event.matches);
      };

      updateIsMobile(mediaQuery);

      const listener = (event: MediaQueryListEvent) => updateIsMobile(event);
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", listener);
        return () => {
          mediaQuery.removeEventListener("change", listener);
        };
      }

      const legacyListener = (event: MediaQueryListEvent) => updateIsMobile(event);
      mediaQuery.addListener(
        legacyListener as unknown as (this: MediaQueryList, event: MediaQueryListEvent) => void
      );
      return () => {
        mediaQuery.removeListener(
          legacyListener as unknown as (this: MediaQueryList, event: MediaQueryListEvent) => void
        );
      };
    }

    const checkIsMobile = () => {
      setIsMobileView(window.innerWidth <= MOBILE_MAX_WIDTH);
    };

    checkIsMobile();
    window.addEventListener("resize", checkIsMobile);

    return () => {
      window.removeEventListener("resize", checkIsMobile);
    };
  }, []);

  return useMemo<RecorderVariant>(() => {
    if (variant === "mini") {
      return "mini";
    }

    return isMobileView ? "mini" : "standard";
  }, [variant, isMobileView]);
}
