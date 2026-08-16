"use client";

import { useIsRestoring } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { PlanStyle } from "@/api/clients/openAI.client";
import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
import { useAiUsage } from "@/hooks/useAiUsage";
import { useDocumentFreshness } from '@/hooks/useDocumentFreshness';
import { useFreshnessUid } from '@/hooks/useFreshnessUid';
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useRouteId } from "@/hooks/useRouteId";
import useSermon from "@/hooks/useSermon";
import { SermonPoint, Sermon, Thought } from "@/models/models";
import { updateThought } from "@/services/thought.service";
import { TimerPhase } from "@/types/TimerState";
import { debugLog } from "@/utils/debugMode";
import { getExportContent as buildThoughtExportContent } from "@/utils/exportContent";
import { normalizePlanArrows } from "@/utils/markdownUtils";
import { liveNodeIds, readPlanText, renderPlanWithFallback } from "@/utils/planText";
import { persistedWrite, refusedWrite, type WriteSubmission } from '@/utils/recoverableWrite';
import {
  planFreshnessProjection,
  type PlanFreshnessProjection,
} from '@/utils/sermonFreshnessProjection';
import { hasPlan } from "@/utils/sermonPlanAccess";
import { getVisualOrderedThoughtsForOutlinePoint } from "@/utils/sermonVisualOrder";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import { writeFailureTranslationKey } from '@/utils/writeRecovery';

import {
  TRANSLATION_KEYS,
  TRANSLATION_SECTIONS_CONCLUSION,
  TRANSLATION_SECTIONS_MAIN,
} from "./constants";
import { copyFormattedFromElement } from "./copyFormattedFromElement";
import { PlanDraftRecoveryBar } from "./PlanDraftRecoveryBar";
import PlanImmersiveView from "./PlanImmersiveView";
import PlanMainLayout from "./PlanMainLayout";
import { buildPlanOutlineLookup, getPointFromLookup, getPointSectionFromLookup } from "./planOutlineLookup";
import PlanOverlayPortal from "./PlanOverlayPortal";
import PlanPreachingView from "./PlanPreachingView";
import { assessPlanReadiness, type PlanReadinessIssue } from "./planReadiness";
import { usePlanTextBaseline } from "./planTextBaseline";
import useCopyFormattedContent from "./useCopyFormattedContent";
import usePairedPlanCardHeights from "./usePairedPlanCardHeights";
import { usePendingPlanCells } from "./usePendingPlanCells";
import usePlanActions from "./usePlanActions";
import usePlanTextDraft from "./usePlanTextDraft";
import usePlanViewMode from "./usePlanViewMode";

import type {
  PlanTimerState,
  SermonSectionKey,
} from "./types";

type ExportContentOptions = { includeTags?: boolean; type?: "thoughts" | "plan" };

const Button = ({
  onClick,
  variant = "default",
  sectionColor,
  className,
  disabled,
  children,
  title
}: {
  onClick?: () => void | Promise<void>,
  variant?: "default" | "primary" | "secondary" | "section" | "plan" | "structure",
  sectionColor?: { base: string, light: string, dark: string },
  className?: string,
  disabled?: boolean,
  children: React.ReactNode,
  title?: string
}) => {
  const baseClasses = "px-4 py-2 text-sm font-medium rounded-md transition-colors";

  let variantClass = "";

  if (variant === "section" && sectionColor) {
    // Для секционных стилей используем базовый класс без цветов,
    // цвета будут применены через inline-стили
    variantClass = "text-white section-button";
  } else {
    const variantClasses: Record<string, string> = {
      default: "bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600",
      primary: "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400",
      secondary: "bg-gray-600 text-white hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-400",
      plan: "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400",
      structure: "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
    };
    variantClass = variantClasses[variant] || variantClasses.default;
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClass} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className || ''}`}
      style={variant === "section" && sectionColor ? {
        backgroundColor: sectionColor.light,
        "--hover-bg": sectionColor.dark,
        "--active-bg": sectionColor.base,
        // Создаем более темный цвет для border
        borderColor: sectionColor.dark,
      } as React.CSSProperties : undefined}
      title={title}
    >
      {children}
    </button>
  );
};

const LoadingSpinner = ({ size = "medium", className = "" }: { size?: "small" | "medium" | "large", className?: string }) => {
  const sizeClasses = {
    small: "w-4 h-4",
    medium: "w-6 h-6",
    large: "w-10 h-10"
  };

  return (
    <div className={`inline-block animate-spin rounded-full border-2 border-solid border-gray-300 border-t-blue-600 ${sizeClasses[size]} ${className}`}></div>
  );
};

export default function PlanPage() {
  const { t } = useTranslation();
  const noContentText = t(TRANSLATION_KEYS.NO_CONTENT);
  const sermonId = useRouteId();
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    mode: planViewMode,
    openOverlay: handleOpenPlanOverlay,
    openImmersive: handleOpenPlanImmersive,
    openPreaching: handleOpenPlanPreaching,
    close: handleClosePlanView,
    isOverlay: isPlanOverlay,
    isImmersive: isPlanImmersive,
    isPreaching: isPlanPreaching,
  } = usePlanViewMode();

  // Handle switching to structure view
  const handleSwitchToStructure = useCallback(() => {
    router.push(`/sermons/${encodeURIComponent(sermonId)}/structure`);
  }, [sermonId, router]);

  const isOnline = useOnlineStatus();
  const { aiBlocked, refresh: refreshAiUsage } = useAiUsage();
  const { sermon, setSermon, loading: isLoadingRaw, error: sermonError, refreshSermon } = useSermon(sermonId);
  /** What the server held for each plan cell when this screen took it — see `planTextBaseline.ts`. */
  const planTextBaseline = usePlanTextBaseline(sermon?.id);

  /**
   * Pull the newer plan in place, without a page reload.
   *
   * Same reason as on the sermon screen: the banner used to announce a newer version
   * and offer no way to take it, so the only route was reloading by hand. Refetching
   * swaps the data and leaves local drafts (generated plan text, open editors) alone.
   */
  const [isRefreshingPlan, setIsRefreshingPlan] = useState(false);
  const handleRefreshPlan = useCallback(async () => {
    if (isRefreshingPlan) return;
    setIsRefreshingPlan(true);
    try {
      await refreshSermon();
      toast.success(t('freshness.refreshedToast'));
    } catch {
      toast.error(t('freshness.refreshFailedToast'));
    } finally {
      setIsRefreshingPlan(false);
    }
  }, [isRefreshingPlan, refreshSermon, t]);

  /**
   * DOES THE SERVER HOLD A NEWER PLAN?
   *
   * This screen had no detector at all, which made it the worst blind spot in the
   * app: the plan is where a preacher spends the most time, and it is exactly what
   * they carry from a laptop to a phone and back. Someone could keep this page open
   * from Friday evening, rewrite the plan from a phone on Saturday, and the laptop
   * would show Friday's version with no hint whatsoever.
   *
   * Observing only — the plan on screen is never swapped underneath anyone. And the
   * fingerprint covers the WHOLE plan (points, sub-points, notes, the generated
   * text), because counts stay identical when wording changes.
   */
  const planFreshnessUid = useFreshnessUid(sermon?.userId);
  // ONE rule for both sides, shared with the sermon screen. Thoughts are compared
  // by content rather than by position: the writer appends, the screen prepends.
  const knownPlan = useMemo<PlanFreshnessProjection | null>(
    () => (sermon ? planFreshnessProjection(sermon as unknown as Record<string, unknown>) : null),
    [sermon]
  );
  const planFreshness = useDocumentFreshness<PlanFreshnessProjection>({
    collection: 'sermons',
    docId: sermonId || null,
    uid: planFreshnessUid,
    enabled: Boolean(sermon),
    known: knownPlan,
    select: (data) => planFreshnessProjection(data),
  });
  const [planFreshnessDismissed, setPlanFreshnessDismissed] = useState(false);
  useEffect(() => {
    if (planFreshness.state === 'stale' || planFreshness.state === 'unknown') {
      setPlanFreshnessDismissed(false);
    }
  }, [planFreshness.remote, planFreshness.state]);
  const sermonRef = useRef<Sermon | null>(sermon);
  const thoughtSaveVersionRef = useRef<Record<string, number>>({});
  const latestThoughtDraftsRef = useRef<Record<string, Thought>>({});
  /** Per thought: the value this screen opened with, then whatever a save confirmed. */
  const thoughtBaselinesRef = useRef<Record<string, Thought>>({});
  const isRestoring = useIsRestoring();
  const isLoading = isLoadingRaw || isRestoring;
  const [error, setError] = useState<string | null>(null);

  // Generated content by outline point ID
  const [generatedContent, setGeneratedContent] = useState<Record<string, string>>({});

  /**
   * The text as it is RIGHT NOW.
   *
   * `handlePlanPointSaved` is a callback: it closes over `generatedContent` as it was when
   * the callback was built. Comparing against that closure compared the sent text with
   * ITSELF, so a cell typed into while the request was in flight was still declared saved —
   * and the seeding effect then replaced what was on screen with the older, saved value.
   * A ref is the only thing here that can answer "what does it say now".
   */
  const generatedContentRef = useRef<Record<string, string>>({});
  useEffect(() => {
    generatedContentRef.current = generatedContent;
  }, [generatedContent]);
  // Currently generating outline point IDs. Multiple point generations can run in parallel.
  const [generatingIds, setGeneratingIds] = useState<Record<string, boolean>>({});

  // Style for plan generation
  const [planStyle, setPlanStyle] = useState<PlanStyle>('memory');

  // State to hold the combined generated content for each section
  /**
   * The document, DERIVED from the structure and whatever text is on screen right now.
   *
   * It used to be its own state, updated by hand after every edit and seeded from a stored
   * string — three copies of one truth that had to be marched in step. Deriving it means
   * "what is shown" and "what is stored" cannot disagree, because there is only one of them.
   */

  const planOverlayContentRef = useRef<HTMLDivElement | null>(null);
  const immersiveContentRef = useRef<HTMLDivElement | null>(null);
  const {
    status: overlayCopyStatus,
    runCopy: runOverlayCopy,
    resetToIdle: resetOverlayCopyStatus,
  } = useCopyFormattedContent({ t });
  const {
    status: immersiveCopyStatus,
    runCopy: runImmersiveCopy,
    resetToIdle: resetImmersiveCopyStatus,
  } = useCopyFormattedContent({ t });

  // Track saved outline points
  const [savedSermonPoints, setSavedSermonPoints] = useState<Record<string, boolean>>({});

  // Track which content has been modified since last save
  const [modifiedContent, setModifiedContent] = useState<Record<string, boolean>>({});

  /** Cells whose write sits in the offline queue — see `usePendingPlanCells`. */
  const pendingPlanCells = usePendingPlanCells(sermon);
  /** Nodes the outline still has — a recovered draft for anything else has nowhere to show. */
  const livePlanNodes = useMemo(() => liveNodeIds(sermon?.outline), [sermon?.outline]);

  /**
   * Text that never reached the server survives a closed tab. The guard states this as its own
   * precondition: refusing a stale save without it turns "overwrote someone else" into "lost
   * your own", which is a move rather than a fix.
   */
  const planDraft = usePlanTextDraft({
    uid: sermon?.userId,
    sermonId: sermon?.id,
    contentByNodeId: generatedContent,
    modifiedNodeIds: modifiedContent,
    pendingNodeIds: pendingPlanCells.nodeIds,
    liveNodeIds: livePlanNodes,
  });
  const restorePlanCells = useCallback((cells: Record<string, string>) => {
    // Recovered cells come back marked UNSAVED — they were never confirmed, so the screen must
    // keep saying so until a save actually succeeds.
    setGeneratedContent((prev) => ({ ...prev, ...cells }));
    setModifiedContent((prev) => ({
      ...prev,
      ...Object.fromEntries(Object.keys(cells).map((nodeId) => [nodeId, true])),
    }));
  }, []);

  // Add state to track which outline points are in edit mode
  const [editModePoints, setEditModePoints] = useState<Record<string, boolean>>({});

  const [modalSermonPointId, setModalSermonPointId] = useState<string | null>(null);

  const [showSectionMenu, setShowSectionMenu] = useState<boolean>(false);
  const sectionMenuRef = useRef<HTMLDivElement>(null);

  // Refs for section auto-scroll - unique for main layout
  const introductionSectionRef = useRef<HTMLDivElement>(null);
  const mainSectionRef = useRef<HTMLDivElement>(null);
  const conclusionSectionRef = useRef<HTMLDivElement>(null);

  // Preaching timer state
  const [preachingDuration, setPreachingDuration] = useState<number | null>(null);

  const [preachingTimerState, setPreachingTimerState] = useState<PlanTimerState | null>(null);
  const outlineLookup = useMemo(
    () => buildPlanOutlineLookup(sermon),
    [sermon]
  );
  const getSectionByPointId = useCallback((outlinePointId: string): SermonSectionKey | null => {
    return getPointSectionFromLookup(outlineLookup, outlinePointId);
  }, [outlineLookup]);

  /**
   * THOUGHTS THAT WILL NOT APPEAR ON THIS SCREEN.
   *
   * A thought with no outline point belongs to no card here, so writing the plan while
   * some are still loose means quietly leaving them behind. That is a real hazard and it
   * is what the old guard was protecting — but the guard protected it by refusing to open
   * the screen at all, which also blocked the case it was never about: building a plan BY
   * HAND, with few thoughts or none.
   *
   * So the wall became a notice. The loose thoughts are counted out loud with one way to
   * go sort them, and the plan itself stays open and editable.
   */
  const unassignedThoughts = useMemo(
    () => (sermon?.thoughts ?? []).filter((thought) => !thought.outlinePointId),
    [sermon]
  );
  const [unassignedNoticeDismissed, setUnassignedNoticeDismissed] = useState(false);
  /**
   * A dismissal belongs to the sermon it was made on AND to the count it was made at.
   * Sorting some thoughts and leaving others behind must not stay hidden under an old
   * "got it" — the number on screen would then describe a state nobody acknowledged.
   */
  useEffect(() => {
    setUnassignedNoticeDismissed(false);
  }, [sermonId, unassignedThoughts.length]);

  useEffect(() => {
    sermonRef.current = sermon;
  }, [sermon]);

  useEffect(() => {
    thoughtSaveVersionRef.current = {};
    latestThoughtDraftsRef.current = {};
    // A baseline belongs to ONE sermon: carried across, it would describe a thought
    // this screen never opened.
    thoughtBaselinesRef.current = {};
  }, [sermonId]);

  const {
    registerPairRef,
    syncPairHeights,
    syncPairHeightsByPointId,
  } = usePairedPlanCardHeights({
    outline: sermon?.outline,
    getSectionByPointId,
  });

  const handleTimerStateChange = useCallback((timerState: PlanTimerState) => {
    // Helper function to format time
    const formatTime = (seconds: number): string => {
      const mins = Math.floor(Math.abs(seconds) / 60);
      const secs = Math.abs(seconds) % 60;
      const sign = seconds < 0 ? '-' : '';
      return `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Calculate progress for all phases in one place for consolidated logging
    const totalProgress = timerState.totalProgress;

    // Calculate progress percentages for each phase using per-phase progress
    const getPhaseProgressPercent = (phase: TimerPhase): number => {
      const byPhase = timerState.phaseProgressByPhase;
      const value = phase === 'introduction'
        ? byPhase.introduction
        : phase === 'main'
          ? byPhase.main
          : byPhase.conclusion;
      return Math.min(Math.max(value, 0), 1) * 100;
    };

    const introProgress = getPhaseProgressPercent('introduction');
    const mainProgress = getPhaseProgressPercent('main');
    const conclusionProgress = getPhaseProgressPercent('conclusion');

    // Consolidated log showing all phases progress and current timer time
    debugLog(`[TIMER] Phase:${timerState.currentPhase} | Intro:${introProgress.toFixed(1)}% | Main:${mainProgress.toFixed(1)}% | Conclusion:${conclusionProgress.toFixed(1)}% | Time:${formatTime(timerState.timeRemaining)} | Total:${(totalProgress * 100).toFixed(1)}%`);

    // Only update state if values actually changed to prevent infinite re-renders
    setPreachingTimerState(prevState => {
      // If this is the first state update (prevState is null), always set the new state
      if (prevState === null) {
        return timerState;
      }

      // Compare values to prevent unnecessary updates
      if (
        prevState.currentPhase === timerState.currentPhase &&
        prevState.phaseProgress === timerState.phaseProgress &&
        prevState.totalProgress === timerState.totalProgress &&
        prevState.phaseProgressByPhase.introduction === timerState.phaseProgressByPhase.introduction &&
        prevState.phaseProgressByPhase.main === timerState.phaseProgressByPhase.main &&
        prevState.phaseProgressByPhase.conclusion === timerState.phaseProgressByPhase.conclusion &&
        prevState.timeRemaining === timerState.timeRemaining &&
        prevState.isFinished === timerState.isFinished
      ) {
        return prevState; // No change, return previous state
      }
      return timerState; // Values changed, update state
    });
  }, []);

  // Close section menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sectionMenuRef.current && !sectionMenuRef.current.contains(event.target as Node)) {
        setShowSectionMenu(false);
      }
    }

    if (showSectionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSectionMenu]);

  useEffect(() => {
    if (!isPlanOverlay) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isPlanOverlay]);

  useEffect(() => {
    if (!isPlanOverlay) {
      resetOverlayCopyStatus();
    }
  }, [isPlanOverlay, resetOverlayCopyStatus]);

  useEffect(() => {
    if (!isPlanImmersive) {
      resetImmersiveCopyStatus();
    }
  }, [isPlanImmersive, resetImmersiveCopyStatus]);

  // Auto-scroll to section based on URL parameter
  useLayoutEffect(() => {
    const sectionParam = searchParams.get('section');

    if (sectionParam && sermon) {
      const scrollToSection = () => {
        // Try refs first (for main layout)
        let targetElement = (() => {
          switch (sectionParam) {
            case 'introduction':
              return introductionSectionRef.current;
            case 'main':
              return mainSectionRef.current;
            case 'conclusion':
              return conclusionSectionRef.current;
            default:
              return null;
          }
        })();

        // Fallback to data attributes (works for all layouts)
        if (!targetElement && typeof document !== 'undefined') {
          targetElement = document.querySelector(`[data-section="${sectionParam}"]`) as HTMLDivElement;
        }

        if (targetElement) {
          targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      };

      // Wait for DOM to be fully rendered
      requestAnimationFrame(() => {
        setTimeout(scrollToSection, 150);
      });
    }
  }, [searchParams, sermon, introductionSectionRef, mainSectionRef, conclusionSectionRef]);

  useEffect(() => {
    if (isLoading) return;

    if (sermonError && isOnline) {
      setError(t("errors.failedToLoadSermon"));
      return;
    }

    if (!sermon && isOnline) {
      setError(t("errors.sermonNotFound"));
      return;
    }

    setError(null);
  }, [isLoading, sermon, sermonError, isOnline, t]);

  /**
   * Seed the editor from stored text — understanding BOTH shapes.
   *
   * `readPlanText` returns the new `planText` map when it is there and falls back to the
   * old per-section cells otherwise, which is what lets this code ship while production and
   * local still share one database and sermons are still in the old shape.
   *
   * The assembled document is no longer seeded from storage: it is rebuilt below from
   * structure plus text, so it cannot be a stale copy of anything.
   */
  useEffect(() => {
    if (!sermon) return;

    // Storage has spoken, so record what it holds for every cell nobody is typing into —
    // that is what the next save is judged against (`planTextBaseline.ts`). A cell whose write
    // is still QUEUED is skipped too: its text is mirrored into the sermon so the screen keeps
    // showing it, and adopting that mirror would vouch for words no server has seen.
    const queuedCells = pendingPlanCells.refresh();
    planTextBaseline.adopt(
      sermon,
      (nodeId) => Boolean(modifiedContent[nodeId]) || queuedCells.has(nodeId)
    );

    const storedText = readPlanText(sermon);
    if (Object.keys(storedText).length === 0) return;

    /**
     * STORAGE WINS EXCEPT WHERE SOMETHING IS BEING TYPED.
     *
     * Laying the screen's value over storage unconditionally (`{...stored, ...prev}`) meant
     * a refresh could never bring anything in: text saved on the phone arrived in `sermon`
     * and was immediately covered by the laptop's older copy, including for cards nobody
     * had touched. Only a cell with unsaved edits may outrank what storage holds.
     */
    setGeneratedContent((prev) => {
      const next = { ...prev, ...storedText };
      Object.keys(prev).forEach((nodeId) => {
        if (modifiedContent[nodeId]) next[nodeId] = prev[nodeId];
      });
      return next;
    });
    setSavedSermonPoints((prev) => ({
      ...Object.fromEntries(Object.keys(storedText).map((nodeId) => [nodeId, true])),
      ...prev,
    }));
  }, [sermon, modifiedContent, pendingPlanCells, planTextBaseline]);

  // Get thoughts for a specific outline point
  const getThoughtsForSermonPoint = useCallback((outlinePointId: string): Thought[] => {
    if (!sermon) return [];
    return getVisualOrderedThoughtsForOutlinePoint(sermon, outlinePointId);
  }, [sermon]);

  // Update section outline deterministically from ordered points + point-content map.
  const combinedPlan = useMemo(
    () => renderPlanWithFallback(sermon, generatedContent),
    [sermon?.outline, generatedContent]
  );

  /**
   * Kept as a no-op seam: the layout still announces an edit so heights can re-sync, but
   * the document itself needs no updating — it is derived above.
   */
  const updateCombinedPlan = useCallback((
    _outlinePointId: string,
    _content: string,
    _section: SermonSectionKey
  ) => undefined, []);

  const handlePlanPointGenerated = (params: {
    outlinePointId: string;
    content: string;
    section: SermonSectionKey;
  }) => {
    const { outlinePointId, content, section } = params;

    setGeneratedContent((prev) => ({
      ...prev,
      [outlinePointId]: content,
    }));
    setModifiedContent((prev) => ({
      ...prev,
      [outlinePointId]: true,
    }));
    updateCombinedPlan(outlinePointId, content, section);
    syncPairHeights(section, outlinePointId);
  };

  const handlePlanPointSaved = useCallback(async (params: {
    outlinePointId: string;
    savedNodeIds: string[];
    section: SermonSectionKey;
    /** Exactly what was written, so text typed mid-flight is not declared saved. */
    sentText?: Record<string, string>;
  }) => {
    const { savedNodeIds, section: _section, sentText } = params;

    /**
     * Only the cells whose text still matches what was SENT are settled.
     *
     * A save takes a moment and people keep typing while it flies. Marking a node saved on
     * the answer alone declared text that never left the browser — and the next departure
     * then left without it, because nothing looked unsaved. The hand-written screen already
     * guards this in `settle`; this is the same guard on the generated path.
     */
    const settled = savedNodeIds.filter(
      (nodeId) => (generatedContentRef.current[nodeId] ?? "") === (sentText?.[nodeId] ?? "")
    );

    setSavedSermonPoints((prev) => ({
      ...prev,
      ...Object.fromEntries(settled.map((nodeId) => [nodeId, true])),
    }));
    setModifiedContent((prev) => ({
      ...prev,
      ...Object.fromEntries(settled.map((nodeId) => [nodeId, false])),
    }));

    /**
     * The saved text goes into `planText`, and the document on screen is rebuilt from it.
     * Previously this also stored an assembled string per section — the copy that then had
     * to be kept in step by hand, and drifted whenever anything else changed.
     *
     * A QUEUED WRITE IS MIRRORED TOO, and the baseline is what keeps that honest. Leaving it
     * out meant that after reopening offline the screen showed the OLDER paragraph, so the
     * person rewrote it blind and the replay buried the first version. Mirroring alone was also
     * wrong, because `adopt` reads this map as "what the server holds". Both are answered by
     * holding the baseline for cells whose write is still queued (`usePendingPlanCells`).
     */
    pendingPlanCells.refresh();

    await setSermon((prevSermon) => (prevSermon
      ? {
          ...prevSermon,
          planText: {
            /**
             * THE STORED MAP, NOT THE MERGED READ. `readPlanText` lays the new cells over the
             * legacy ones so the screen has something to show; copying that result back into
             * `planText` made every legacy cell look WRITTEN after any save at all. That flag
             * is what `renderPlanWithFallback` consults before serving an old sermon's
             * assembled section, so one save blanked every section nobody had touched yet.
             */
            ...(prevSermon.planText ?? {}),
            /**
             * Mirror EXACTLY what was written — `sentText` — not the editor's current value.
             *
             * Reading `generatedContent` here was the second stale closure: the callback
             * holds the map as it was when it was built, so a successful save could put an
             * OLD (often empty) value into the local sermon. The seeding effect then saw a
             * clean cell and replaced the screen with it, and the next save wrote that back
             * over the correct text on the server.
             */
            ...Object.fromEntries(savedNodeIds.map((nodeId) => [nodeId, sentText?.[nodeId] ?? ""])),
          },
        }
      : null));
  }, [setSermon]);

  const {
    generateSermonPointContent,
    saveSermonPoint,
  } = usePlanActions({
    sermon,
    planStyle,
    outlineLookup,
    generatedContent,
    t,
    setGeneratingIds,
    onGenerated: handlePlanPointGenerated,
    onSaved: handlePlanPointSaved,
    onAiSuccess: refreshAiUsage,
    aiBlocked,
    planTextBaseline,
  });

  // Toggle edit mode for an outline point
  const toggleEditMode = (outlinePointId: string) => {
    setEditModePoints(prev => ({
      ...prev,
      [outlinePointId]: !prev[outlinePointId]
    }));

    // After toggling, equalize only this pair to avoid page-wide jumps
    syncPairHeightsByPointId(outlinePointId);
  };

  const handleThoughtSave = useCallback((updatedThought: Thought): WriteSubmission => {
    const currentSermon = sermonRef.current;
    // Reporting `persisted` here announced a save that never happened — and with no
    // sermon loaded there is nothing holding the edit either. Refuse, so the editor
    // keeps the text instead of closing over it.
    if (!currentSermon) {
      return refusedWrite('not-found', 'This sermon is no longer available', t('writeRecovery.refused'));
    }

    const thoughtId = updatedThought.id;
    const previousThought = currentSermon.thoughts.find((thought) => thought.id === thoughtId);

    // Version guard: rapid successive edits to the same thought must not let an
    // older in-flight save clobber a newer draft (kept from the old mechanism).
    const saveVersion = (thoughtSaveVersionRef.current[thoughtId] ?? 0) + 1;
    thoughtSaveVersionRef.current[thoughtId] = saveVersion;
    latestThoughtDraftsRef.current[thoughtId] = updatedThought;

    /**
     * WHAT THIS SCREEN BELIEVED TO BE STORED before the person started editing.
     *
     * Recorded ONCE per thought and only advanced by a confirmed save, so the write
     * below states just the fields the person actually touched. Taken from the live
     * cache on every save instead, an untouched field would be re-sent from whatever
     * this tab happens to hold and would revert an edit made on another device —
     * the trap spelled out in `utils/changedFields.ts`.
     */
    if (previousThought && !thoughtBaselinesRef.current[thoughtId]) {
      thoughtBaselinesRef.current[thoughtId] = previousThought;
    }

    // Optimistic (React Query cache via setSermon): show the edit immediately;
    // the client-SDK write lands in the native Firestore offline queue.
    setSermon((prevSermon) =>
      prevSermon
        ? {
            ...prevSermon,
            thoughts: prevSermon.thoughts.map((thought) =>
              thought.id === thoughtId ? updatedThought : thought
            ),
          }
        : prevSermon
    );

    const executeSave = async (requestVersion: number) => {
      const latestThought = latestThoughtDraftsRef.current[thoughtId];
      const latestSermon = sermonRef.current;
      if (!latestThought || !latestSermon) {
        return updatedThought;
      }

      try {
        const savedThought = await updateThought(
          latestSermon.id,
          latestThought,
          thoughtBaselinesRef.current[thoughtId] ?? null
        );
        if (thoughtSaveVersionRef.current[thoughtId] !== requestVersion) {
          return savedThought;
        }
        // CONFIRMED: this is now what the screen knows to be stored.
        thoughtBaselinesRef.current[thoughtId] = savedThought;

        setSermon((prevSermon) => {
          if (!prevSermon) return prevSermon;
          return {
            ...prevSermon,
            thoughts: prevSermon.thoughts.map((thought) =>
              thought.id === savedThought.id ? savedThought : thought
            ),
          };
        });

        delete latestThoughtDraftsRef.current[thoughtId];
        delete thoughtSaveVersionRef.current[thoughtId];
        return savedThought;
      } catch (error) {
        if (thoughtSaveVersionRef.current[thoughtId] !== requestVersion) {
          throw error;
        }
        // Roll the cache back to the pre-edit thought and surface the failure
        // (replaces the old inline sync-error badge).
        if (previousThought) {
          setSermon((prevSermon) =>
            prevSermon
              ? {
                  ...prevSermon,
                  thoughts: prevSermon.thoughts.map((thought) =>
                    thought.id === thoughtId ? previousThought : thought
                  ),
                }
              : prevSermon
          );
        }
        toast.error(t(writeFailureTranslationKey(error, "errors.failedToSaveThought")));
        throw error;
      }
    };

    return persistedWrite(executeSave(saveVersion));
  }, [setSermon, t]);

  // Find outline point by id
  const findSermonPointById = useCallback((outlinePointId: string): SermonPoint | undefined => {
    return getPointFromLookup(outlineLookup, outlinePointId);
  }, [outlineLookup]);


  const handleSetTimerDuration = useCallback((durationSeconds: number) => {
    setPreachingDuration(durationSeconds);
  }, []);


  const handleStartPreachingMode = useCallback(() => {
    // Start preaching mode - timer starts at 0:00 (idle state)
    setPreachingDuration(null); // Start with no duration (timer will be idle)
    // Use push so that router.back() from preaching returns to this plan page, not to sermon/dashboard
    handleOpenPlanPreaching();
  }, [handleOpenPlanPreaching]);

  // Alias for compatibility with ViewPlanMenu component
  const handleOpenTimePicker = handleStartPreachingMode;

  // Generate content for export as text
  const getExportContent = async (
    format: 'plain' | 'markdown',
    options: ExportContentOptions = {},
  ): Promise<string> => {
    if (!sermon) return '';
    const exportType = options.type ?? 'plan';

    if (exportType === 'thoughts') {
      return buildThoughtExportContent(sermon, undefined, {
        format,
        includeTags: Boolean(options.includeTags),
        type: 'thoughts',
      });
    }

    const titleSection = `# ${sermon.title}\n\n`;
    const verseSection = sermon.verse ? `> ${sermon.verse}\n\n` : '';

    // Format the outline points and their content
    // Use combinedPlan which reflects the current UI state (both saved and edited)
    const introSection = `## ${t(TRANSLATION_KEYS.SECTIONS.INTRODUCTION)}\n\n${combinedPlan.introduction || noContentText}\n\n`;
    const mainSection = `## ${t(TRANSLATION_SECTIONS_MAIN)}\n\n${combinedPlan.main || noContentText}\n\n`;
    const conclusionSection = `## ${t(TRANSLATION_SECTIONS_CONCLUSION)}\n\n${combinedPlan.conclusion || noContentText}\n\n`;

    // Combine all sections. Normalize arrows / decode HTML entities so copy + TXT export
    // match the plan UI and the Word export (no stray "->", "-&gt;").
    const markdown = normalizePlanArrows(`${titleSection}${verseSection}${introSection}${mainSection}${conclusionSection}`);

    // For plain text, we need to strip markdown formatting
    if (format === 'plain') {
      // A very simple markdown to plain text conversion - for a proper conversion, use a library
      return markdown
        .replace(/#{1,6}\s(.*)/g, '$1\n') // headers
        .replace(/\*\*(.*?)\*\*/g, '$1') // bold
        .replace(/\*(.*?)\*/g, '$1') // italic
        .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)') // links
        .replace(/\n>/g, '\n') // blockquotes
        .replace(/>/g, '') // blockquotes at start
        .replace(/\n\n+/g, '\n\n'); // multiple line breaks
    }

    return markdown;
  };

  // Generate content for PDF export
  const getPdfContent = async (): Promise<React.ReactNode> => {
    if (!sermon) return null;

    return (
      <div className="p-6 bg-white text-black" style={{ fontFamily: 'Arial, sans-serif' }}>
        <h1 className="text-3xl font-bold mb-4">{sermon.title}</h1>

        {sermon.verse && (
          <div className="mb-8 p-4 bg-gray-50 rounded-md border-l-4 border-blue-500">
            <p className="text-gray-700 italic text-lg whitespace-pre-line">
              {sermon.verse}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              {t(TRANSLATION_KEYS.COMMON.SCRIPTURE)}
            </p>
          </div>
        )}

        <div className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]}`}>
          <h2 className={`text-2xl font-bold ${SERMON_SECTION_COLORS.introduction.text} mb-4`}>
            {t(TRANSLATION_KEYS.SECTIONS.INTRODUCTION)}
          </h2>
          <div className={`pl-2 border-l-4 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]}`}>
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {normalizePlanArrows(combinedPlan.introduction || noContentText)}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        <div className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]}`}>
          <h2 className={`text-2xl font-bold ${SERMON_SECTION_COLORS.mainPart.text} mb-4`}>
            {t(TRANSLATION_SECTIONS_MAIN)}
          </h2>
          <div className={`pl-2 border-l-4 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]}`}>
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {normalizePlanArrows(combinedPlan.main || noContentText)}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <h2 className={`text-2xl font-bold ${SERMON_SECTION_COLORS.conclusion.text} mb-4`}>
            {t(TRANSLATION_SECTIONS_CONCLUSION)}
          </h2>
          <div className={`pl-2 border-l-4 ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]}`}>
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {normalizePlanArrows(combinedPlan.conclusion || noContentText)}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (error || !sermon) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-2xl font-bold text-red-600 mb-4">{error}</h1>
        <Button
          onClick={() => router.push(`/sermons/${sermonId}`)}
          variant="default"
          className="px-6 py-3 text-base"
        >
          {t("actions.backToSermon")}
        </Button>
      </div>
    );
  }

  // Guard: no outline points defined at all — user must create structure first
  /**
   * NO THOUGHTS — A FORK, NOT A WALL.
   *
   * Two wrong answers were tried here. The original screen REFUSED to open, which also
   * blocked the person who never intended to use thoughts. Removing the refusal outright
   * went too far the other way: someone who simply had not recorded their thoughts yet
   * landed in an empty writing surface with no hint that dictation exists.
   *
   * So the screen states what is missing and offers all three real continuations —
   * go record thoughts, go sort them, or write the conspectus by hand.
   *
   * "Write by hand" leads to a SCREEN OF ITS OWN (`plan/manual`), not to a flag on this
   * one. A query parameter only skipped this gate while the layout still decided its shape
   * from whether thoughts existed — so someone with one loose thought asked to write by
   * hand and got the paired view anyway.
   *
   * Started text is deliberately NOT treated as an answer either. Whether the sermon is
   * whole is the question; whether something was typed earlier does not answer it.
   */

  /**
   * WHOLE ENOUGH TO GENERATE FROM — the four conditions live in `planReadiness.ts`, with
   * the reasons, so this screen only has to render them. The gate is not a refusal: it is
   * the door into writing by hand, walked through knowingly and with the missing pieces
   * named, because "not ready" with no explanation is a wall.
   */
  const readiness = assessPlanReadiness(sermon);

  const describeIssue = (issue: PlanReadinessIssue): string => {
    switch (issue.kind) {
      case "noThoughts":
        return t("plan.missingThoughts");
      case "noPoints":
        return t("plan.missingPoints");
      case "unassignedThoughts":
        return t("plan.missingUnassigned", { amount: issue.count });
      case "orphanThoughts":
        return t("plan.missingOrphans", { amount: issue.count });
      case "emptyPoints": {
        // "Intro Point, Intro Point" named two different points identically and helped
        // nobody. Section and position are what actually find them on screen.
        const named = (issue.points ?? [])
          .map((point) => {
            const where = `${t(`sections.${point.section}`)} ${point.position}`;
            return point.title ? `${where} · ${point.title}` : where;
          })
          .join("; ");
        const hidden = (issue.count ?? 0) - (issue.points?.length ?? 0);
        return hidden > 0
          ? t("plan.missingEmptyPointsMore", { names: named, amount: hidden })
          : t("plan.missingEmptyPoints", { names: named });
      }
      default:
        return "";
    }
  };

  /**
   * THE WARNING SCREEN STANDS WHERE THERE IS NOTHING TO SHOW, NEVER IN FRONT OF A WRITTEN PLAN.
   *
   * Readiness answers "is this whole enough to GENERATE from" — it was never meant to answer
   * "may this person read what they already wrote". Gating the render on it alone meant one
   * new thought, dropped in after the plan was finished, hid the document someone was about
   * to preach from. That is the very failure `getSermonAccessType` stopped committing: it no
   * longer routes people away over a loose thought, on the promise that this screen reports
   * it in words. The unsorted banner below is that promise — and it is unreachable from here.
   *
   * So the gate applies only while the plan is still empty. Once there is text, the text wins
   * and the banner does the telling.
   */
  if (!readiness.ready && !hasPlan(sermon)) {
    return (
      <div className="p-8 text-center max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">{t("plan.notReadyTitle")}</h1>
          <ul className="mb-3 inline-block text-left text-gray-700 dark:text-gray-200">
            {readiness.issues.map((issue) => (
              <li key={issue.kind} className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                {describeIssue(issue)}
              </li>
            ))}
          </ul>
          <p className="text-gray-600 dark:text-gray-300 text-lg">{t("plan.notReadyDescription")}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            onClick={() => router.push(`/sermons/${sermonId}`)}
            variant="plan"
            className="px-6 py-3 text-base"
          >
            {t("plan.workOnSermon")}
          </Button>
          <Button
            onClick={handleSwitchToStructure}
            variant="structure"
            className="px-6 py-3 text-base"
          >
            {t("plan.workOnStructure")}
          </Button>
          <Button
            onClick={() => router.push(`/sermons/${sermonId}/plan/manual`)}
            variant="secondary"
            className="px-6 py-3 text-base"
          >
            {t("plan.writeByHand")}
          </Button>
        </div>
      </div>
    );
  }

  /**
   * NO OUTLINE POINTS IS NOT A DEAD END ANY MORE.
   *
   * This used to send people to the structure screen, because points could only be
   * created there. They can be created right here now, so the redirect became a detour:
   * a sermon with a thought but no points landed on "no plan structure" with no way to
   * make one, which is exactly where the owner got stuck.
   *
   * An empty plan simply renders its three sections, each offering to add the first point.
   */

  if (isPlanImmersive) {
    return (
      <PlanImmersiveView
        sermon={sermon}
        combinedPlan={combinedPlan}
        t={t}
        timerState={preachingTimerState}
        isPreachingMode={isPlanPreaching}
        noContentText={noContentText}
        copyStatus={immersiveCopyStatus}
        immersiveContentRef={immersiveContentRef}
        onCopy={() => runImmersiveCopy(() => copyFormattedFromElement(immersiveContentRef.current))}
        onOpenPlanOverlay={handleOpenPlanOverlay}
        onClosePlanView={handleClosePlanView}
      />
    );
  }

  if (isPlanPreaching && sermon) {
    return (
      <PlanPreachingView
        sermon={sermon}
        combinedPlan={combinedPlan}
        t={t}
        timerState={preachingTimerState}
        isPlanPreaching={isPlanPreaching}
        planViewMode={planViewMode}
        noContentText={noContentText}
        preachingDuration={preachingDuration}
        onTimerStateChange={handleTimerStateChange}
        onTimerFinished={() => {
          debugLog('Timer finished naturally, showing negative countdown');
        }}
        onSetDuration={handleSetTimerDuration}
      />
    );
  }

  return (
    <>
      {planDraft.recovered && (
        <PlanDraftRecoveryBar
          count={Object.keys(planDraft.recovered).length}
          onRestore={() => {
            restorePlanCells(planDraft.recovered ?? {});
            planDraft.accept();
          }}
          onDiscard={planDraft.discard}
        />
      )}

      {/* Deliberately NOT shown in preaching or immersive view: someone standing in
          front of a congregation must not be handed a decision. */}
      {(planFreshness.state === 'stale' || planFreshness.state === 'unknown') &&
        !planFreshnessDismissed && (
          <DataFreshnessBanner
            entityKey="entitySermon"
            // Not a constant: this screen DOES hold unsaved cells, and claiming otherwise made
            // the banner offer to replace text someone was in the middle of writing.
            dirty={Object.values(modifiedContent).some(Boolean)}
            deleted={planFreshness.remotelyDeleted}
            unknown={planFreshness.state === 'unknown'}
            onRefresh={handleRefreshPlan}
            refreshing={isRefreshingPlan}
            onDismiss={() => setPlanFreshnessDismissed(true)}
            className="mb-3"
          />
        )}
      {/* EVERYTHING THE DOOR WOULD HAVE SAID, SAID BESIDE THE PLAN INSTEAD.
          Once there is text, the warning screen steps aside — but the findings must not go
          with it. Loose thoughts were only one of them; a thought left pointing at a deleted
          point, or a point with nothing under it, are exactly the things nobody notices on
          their own. Listing them here keeps the report without blocking the read.
          Like the freshness banner above, it is absent from the preaching and immersive
          views: those returned earlier, and nobody facing a congregation needs a chore. */}
      {!readiness.ready && !unassignedNoticeDismissed && (
        <div
          role="status"
          className="mb-3 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {/* `amount`, not `count`: `count` would send i18next hunting for plural
                  keys that do not exist. The wording carries any number as it is. */}
              {unassignedThoughts.length > 0
                ? t("plan.unassignedNotice.title", { amount: unassignedThoughts.length })
                : t("plan.issuesNoticeTitle")}
            </p>
            <ul className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
              {readiness.issues.map((issue) => (
                <li key={issue.kind}>{describeIssue(issue)}</li>
              ))}
            </ul>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={handleSwitchToStructure}
              className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700"
            >
              {t("plan.unassignedNotice.sortAction")}
            </button>
            <button
              type="button"
              onClick={() => setUnassignedNoticeDismissed(true)}
              className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
            >
              {t("plan.unassignedNotice.dismissAction")}
            </button>
          </div>
        </div>
      )}
      <PlanOverlayPortal
        isPlanOverlay={isPlanOverlay}
        sermon={sermon}
        combinedPlan={combinedPlan}
        t={t}
        timerState={preachingTimerState}
        isPreachingMode={isPlanPreaching}
        noContentText={noContentText}
        copyStatus={overlayCopyStatus}
        planOverlayContentRef={planOverlayContentRef}
        onCopy={() => runOverlayCopy(() => copyFormattedFromElement(planOverlayContentRef.current))}
        onOpenPlanImmersive={handleOpenPlanImmersive}
        onClosePlanView={handleClosePlanView}
      />
      <PlanMainLayout
        sermon={sermon}
        params={{ id: sermonId as string }}
        sermonId={sermonId}
        t={t}
        combinedPlan={combinedPlan}
        noContentText={noContentText}
        planStyle={planStyle}
        setPlanStyle={setPlanStyle}
        isLoading={isLoading}
        generatingIds={generatingIds}
        aiBlocked={aiBlocked}
        sectionMenuRef={sectionMenuRef}
        showSectionMenu={showSectionMenu}
        setShowSectionMenu={setShowSectionMenu}
        registerPairRef={registerPairRef}
        introductionSectionRef={introductionSectionRef}
        mainSectionRef={mainSectionRef}
        conclusionSectionRef={conclusionSectionRef}
        generatedContent={generatedContent}
        modifiedContent={modifiedContent}
        savedSermonPoints={savedSermonPoints}
        editModePoints={editModePoints}
        modalSermonPointId={modalSermonPointId}
        setModalSermonPointId={setModalSermonPointId}
        findSermonPointById={findSermonPointById}
        onThoughtSave={handleThoughtSave}
        getThoughtsForSermonPoint={getThoughtsForSermonPoint}
        onGenerate={generateSermonPointContent}
        onSaveSermonPoint={saveSermonPoint}
        onToggleEditMode={toggleEditMode}
        onSyncPairHeights={syncPairHeights}
        onUpdateCombinedPlan={updateCombinedPlan}
        setGeneratedContent={setGeneratedContent}
        setModifiedContent={setModifiedContent}
        onSwitchToStructure={handleSwitchToStructure}
        onRequestPlanOverlay={handleOpenPlanOverlay}
        onRequestPreachingMode={handleOpenTimePicker}
        onStartPreachingMode={handleStartPreachingMode}
        getExportContent={getExportContent}
        getPdfContent={getPdfContent}
      />
    </>
  );
}
