import { useCallback, useEffect, useRef } from "react";

import type { RegisterPairedCardRef, SermonSectionKey } from "./types";
import type { Sermon } from "@/models/models";

type PairRef = {
  left: HTMLDivElement | null;
  right: HTMLDivElement | null;
};

type SectionPairRefs = Record<string, PairRef>;

interface UsePairedPlanCardHeightsParams {
  outline: Sermon["outline"] | undefined;
  getSectionByPointId: (pointId: string) => SermonSectionKey | null;
}

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const RESIZE_DEBOUNCE_MS = 200;
const INITIAL_SYNC_DELAY_MS = 150;

export default function usePairedPlanCardHeights({
  outline,
  getSectionByPointId,
}: UsePairedPlanCardHeightsParams) {
  const introPointRefs = useRef<SectionPairRefs>({});
  const mainPointRefs = useRef<SectionPairRefs>({});
  const conclusionPointRefs = useRef<SectionPairRefs>({});
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getRefsForSection = useCallback((section: SermonSectionKey) => {
    switch (section) {
      case "introduction":
        return introPointRefs;
      case "main":
        return mainPointRefs;
      case "conclusion":
      default:
        return conclusionPointRefs;
    }
  }, []);

  const registerPairRef = useCallback<RegisterPairedCardRef>((section, pointId, side, element) => {
    const sectionRefs = getRefsForSection(section);
    if (!sectionRefs.current[pointId]) {
      sectionRefs.current[pointId] = { left: null, right: null };
    }

    sectionRefs.current[pointId][side] = element;
  }, [getRefsForSection]);

  const resetSectionRefsHeight = useCallback((sectionRefs: SectionPairRefs) => {
    Object.values(sectionRefs).forEach(({ left, right }) => {
      if (left) left.style.height = "auto";
      if (right) right.style.height = "auto";
    });
  }, []);

  const isLargeViewport = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  }, []);

  const applyPairHeight = useCallback((left: HTMLDivElement, right: HTMLDivElement, height: number) => {
    const nextHeight = `${height}px`;
    if (left.style.height !== nextHeight) {
      left.style.height = nextHeight;
    }
    if (right.style.height !== nextHeight) {
      right.style.height = nextHeight;
    }
  }, []);

  const getNaturalHeight = useCallback((element: HTMLDivElement) => {
    return Math.max(element.offsetHeight, element.scrollHeight);
  }, []);

  const syncAllHeights = useCallback(() => {
    resetSectionRefsHeight(introPointRefs.current);
    resetSectionRefsHeight(mainPointRefs.current);
    resetSectionRefsHeight(conclusionPointRefs.current);

    if (!isLargeViewport()) {
      return;
    }

    // Force reflow so offsetHeight reflects natural content height.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    document.body.offsetHeight;

    const applyMaxHeights = (sectionRefs: SectionPairRefs) => {
      Object.values(sectionRefs).forEach(({ left, right }) => {
        if (!left || !right) return;
        const maxHeight = Math.max(left.offsetHeight, right.offsetHeight);
        applyPairHeight(left, right, maxHeight);
      });
    };

    applyMaxHeights(introPointRefs.current);
    applyMaxHeights(mainPointRefs.current);
    applyMaxHeights(conclusionPointRefs.current);
  }, [applyPairHeight, isLargeViewport, resetSectionRefsHeight]);

  const syncPairHeightsWithReset = useCallback((section: SermonSectionKey, pointId: string) => {
    const sectionRefs = getRefsForSection(section);
    const pair = sectionRefs.current[pointId];
    if (!pair?.left || !pair?.right) return;

    if (!isLargeViewport()) {
      pair.left.style.height = "auto";
      pair.right.style.height = "auto";
      return;
    }

    requestAnimationFrame(() => {
      const latestPair = sectionRefs.current[pointId];
      if (!latestPair?.left || !latestPair?.right) return;

      latestPair.left.style.height = "auto";
      latestPair.right.style.height = "auto";

      requestAnimationFrame(() => {
        const finalPair = sectionRefs.current[pointId];
        if (!finalPair?.left || !finalPair?.right) return;

        const maxHeight = Math.max(finalPair.left.offsetHeight, finalPair.right.offsetHeight);
        applyPairHeight(finalPair.left, finalPair.right, maxHeight);
      });
    });
  }, [applyPairHeight, getRefsForSection, isLargeViewport]);

  const syncPairHeights = useCallback((section: SermonSectionKey, pointId: string) => {
    const sectionRefs = getRefsForSection(section);
    const pair = sectionRefs.current[pointId];
    if (!pair?.left || !pair?.right) return;

    if (!isLargeViewport()) {
      pair.left.style.height = "auto";
      pair.right.style.height = "auto";
      return;
    }

    requestAnimationFrame(() => {
      const latestPair = sectionRefs.current[pointId];
      if (!latestPair?.left || !latestPair?.right) return;

      const maxHeight = Math.max(
        getNaturalHeight(latestPair.left),
        getNaturalHeight(latestPair.right)
      );
      applyPairHeight(latestPair.left, latestPair.right, maxHeight);
    });
  }, [applyPairHeight, getNaturalHeight, getRefsForSection, isLargeViewport]);

  const syncPairHeightsByPointId = useCallback((pointId: string) => {
    const section = getSectionByPointId(pointId);
    if (!section) return;
    syncPairHeightsWithReset(section, pointId);
  }, [getSectionByPointId, syncPairHeightsWithReset]);

  useEffect(() => {
    const timer = setTimeout(() => {
      syncAllHeights();
    }, INITIAL_SYNC_DELAY_MS);

    return () => clearTimeout(timer);
  }, [outline, syncAllHeights]);

  useEffect(() => {
    const onResize = () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }

      resizeTimeoutRef.current = setTimeout(() => {
        syncAllHeights();
      }, RESIZE_DEBOUNCE_MS);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("resize", onResize);
    }

    return () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", onResize);
      }
    };
  }, [syncAllHeights]);

  return {
    registerPairRef,
    syncPairHeights,
    syncPairHeightsByPointId,
    syncAllHeights,
  };
}
