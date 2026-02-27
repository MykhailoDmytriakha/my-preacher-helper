"use client";

import { useIsRestoring } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { PlanStyle } from "@/api/clients/openAI.client";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import useSermon from "@/hooks/useSermon";
import { SermonPoint, Sermon, Thought, Plan } from "@/models/models";
import { TimerPhase } from "@/types/TimerState";
import { debugLog } from "@/utils/debugMode";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import { getThoughtsForOutlinePoint } from "@/utils/thoughtOrdering";

import { buildSectionOutlineMarkdown } from "./buildSectionOutlineMarkdown";
import {
  TRANSLATION_KEYS,
  TRANSLATION_SECTIONS_CONCLUSION,
  TRANSLATION_SECTIONS_MAIN,
} from "./constants";
import PlanImmersiveView from "./PlanImmersiveView";
import PlanMainLayout from "./PlanMainLayout";
import { buildPlanOutlineLookup, getPointFromLookup, getPointSectionFromLookup } from "./planOutlineLookup";
import PlanOverlayPortal from "./PlanOverlayPortal";
import PlanPreachingView from "./PlanPreachingView";
import useCopyFormattedContent from "./useCopyFormattedContent";
import usePairedPlanCardHeights from "./usePairedPlanCardHeights";
import usePlanActions from "./usePlanActions";
import usePlanViewMode from "./usePlanViewMode";

import type {
  CombinedPlan,
  PlanTimerState,
  SermonSectionKey,
} from "./types";

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
  const params = useParams();
  const sermonId = params?.id as string;
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
  const { sermon, setSermon, loading: isLoadingRaw, error: sermonError } = useSermon(sermonId);
  const isRestoring = useIsRestoring();
  const isLoading = isLoadingRaw || isRestoring;
  const [error, setError] = useState<string | null>(null);

  // Generated content by outline point ID
  const [generatedContent, setGeneratedContent] = useState<Record<string, string>>({});
  // Currently generating outline point ID
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  // Style for plan generation
  const [planStyle, setPlanStyle] = useState<PlanStyle>('memory');

  // State to hold the combined generated content for each section
  const [combinedPlan, setCombinedPlan] = useState<CombinedPlan>({ introduction: '', main: '', conclusion: '' });

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

  useEffect(() => {
    if (!sermon) return;

    if (sermon.plan) {
      setCombinedPlan({
        introduction: sermon.plan.introduction?.outline || "",
        main: sermon.plan.main?.outline || "",
        conclusion: sermon.plan.conclusion?.outline || "",
      });

      const savedContent: Record<string, string> = {};
      const savedPoints: Record<string, boolean> = {};

      ['introduction', 'main', 'conclusion'].forEach(sectionKey => {
        const section = sermon.plan?.[sectionKey as keyof Plan];
        const outlinePoints = section?.outlinePoints || {};

        Object.entries(outlinePoints).forEach(([pointId, content]) => {
          savedContent[pointId] = content;
          savedPoints[pointId] = true;
        });
      });

      if (Object.keys(savedContent).length > 0) {
        setGeneratedContent(prev => ({ ...prev, ...savedContent }));
      }

      if (Object.keys(savedPoints).length > 0) {
        setSavedSermonPoints(savedPoints);
      }
    }
  }, [sermon]);

  // Check if all thoughts are assigned to outline points
  const areAllThoughtsAssigned = (sermon: Sermon | null): boolean => {
    if (!sermon) return false;

    // Count thoughts that aren't assigned to an outline point
    const unassignedThoughts = sermon.thoughts.filter(
      (thought) => !thought.outlinePointId
    );

    return unassignedThoughts.length === 0;
  };

  // Get thoughts for a specific outline point
  const getThoughtsForSermonPoint = (outlinePointId: string): Thought[] => {
    if (!sermon) return [];
    return getThoughtsForOutlinePoint(sermon, outlinePointId);
  };

  // Update section outline deterministically from ordered points + point-content map.
  const updateCombinedPlan = useCallback((
    outlinePointId: string,
    content: string,
    section: SermonSectionKey
  ) => {
    const orderedOutlinePoints = outlineLookup.pointsBySection[section] || [];
    const nextOutlinePointsContentById = {
      ...generatedContent,
      [outlinePointId]: content,
    };

    const nextSectionOutline = buildSectionOutlineMarkdown({
      orderedOutlinePoints,
      outlinePointsContentById: nextOutlinePointsContentById,
    });

    setCombinedPlan((prev) => ({
      ...prev,
      [section]: nextSectionOutline,
    }));
  }, [generatedContent, outlineLookup.pointsBySection]);

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
    section: SermonSectionKey;
    combinedText: string;
    updatedPlan: Plan;
  }) => {
    const {
      outlinePointId,
      section,
      combinedText,
      updatedPlan,
    } = params;

    setSavedSermonPoints((prev) => ({ ...prev, [outlinePointId]: true }));
    setModifiedContent((prev) => ({ ...prev, [outlinePointId]: false }));
    setCombinedPlan((prev) => ({
      ...prev,
      [section]: combinedText,
    }));

    await setSermon((prevSermon) => (prevSermon ? { ...prevSermon, plan: updatedPlan } : null));
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
    setGeneratingId,
    onGenerated: handlePlanPointGenerated,
    onSaved: handlePlanPointSaved,
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

  // Handle thought update from key fragments modal
  const handleThoughtUpdate = (updatedThought: Thought) => {
    setSermon(prevSermon => {
      if (!prevSermon) return null;
      return {
        ...prevSermon,
        thoughts: prevSermon.thoughts.map(t =>
          t.id === updatedThought.id ? updatedThought : t
        )
      };
    });
  };

  // Find outline point by id
  const findSermonPointById = useCallback((outlinePointId: string): SermonPoint | undefined => {
    return getPointFromLookup(outlineLookup, outlinePointId);
  }, [outlineLookup]);

  const copyFormattedFromElement = useCallback(async (element: HTMLDivElement | null) => {
    if (!element) {
      return false;
    }

    const plainText = element.innerText ?? '';
    const htmlContent = element.innerHTML ?? '';

    const advancedClipboardAvailable =
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.clipboard &&
      typeof navigator.clipboard.write === 'function' &&
      'ClipboardItem' in window;

    try {
      if (advancedClipboardAvailable) {
        const clipboardWindow = window as typeof window & { ClipboardItem: typeof ClipboardItem };
        const clipboardItem = new clipboardWindow.ClipboardItem({
          'text/html': new Blob([htmlContent], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' })
        });
        await navigator.clipboard.write([clipboardItem]);
        return true;
      }

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(plainText);
        return true;
      }
    } catch (error) {
      debugLog("Plan copy failed: ClipboardItem/write branch", { error });
    }

    const selection = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
    const range = document.createRange();
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'fixed';
    tempContainer.style.pointerEvents = 'none';
    tempContainer.style.opacity = '0';
    tempContainer.style.zIndex = '-1';
    tempContainer.innerHTML = htmlContent || plainText;
    document.body.appendChild(tempContainer);

    try {
      range.selectNodeContents(tempContainer);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (document.execCommand('copy')) {
        selection?.removeAllRanges();
        document.body.removeChild(tempContainer);
        return true;
      }
    } catch (error) {
      debugLog("Plan copy failed: execCommand(html) branch", { error });
    } finally {
      selection?.removeAllRanges();
      document.body.removeChild(tempContainer);
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = plainText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus({ preventScroll: true });
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (error) {
      debugLog("Plan copy failed: execCommand(text) branch", { error });
    }

    return false;
  }, []);

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
  const getExportContent = async (format: 'plain' | 'markdown'): Promise<string> => {
    if (!sermon) return '';

    const titleSection = `# ${sermon.title}\n\n`;
    const verseSection = sermon.verse ? `> ${sermon.verse}\n\n` : '';

    // Format the outline points and their content
    // Use combinedPlan which reflects the current UI state (both saved and edited)
    const introSection = `## ${t(TRANSLATION_KEYS.SECTIONS.INTRODUCTION)}\n\n${combinedPlan.introduction || noContentText}\n\n`;
    const mainSection = `## ${t(TRANSLATION_SECTIONS_MAIN)}\n\n${combinedPlan.main || noContentText}\n\n`;
    const conclusionSection = `## ${t(TRANSLATION_SECTIONS_CONCLUSION)}\n\n${combinedPlan.conclusion || noContentText}\n\n`;

    // Combine all sections
    const markdown = `${titleSection}${verseSection}${introSection}${mainSection}${conclusionSection}`;

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
                {combinedPlan.introduction || noContentText}
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
                {combinedPlan.main || noContentText}
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
                {combinedPlan.conclusion || noContentText}
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
          onClick={() => router.push(`/sermons/${params.id}`)}
          variant="default"
          className="px-6 py-3 text-base"
        >
          {t("actions.backToSermon")}
        </Button>
      </div>
    );
  }

  // Check if all thoughts are assigned to outline points
  if (!areAllThoughtsAssigned(sermon)) {
    return (
      <div className="p-8 text-center max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">{t("plan.thoughtsNotAssigned")}</h1>
          <p className="text-gray-600 dark:text-gray-300 text-lg">{t("plan.assignThoughtsFirst")}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            onClick={() => router.push(`/sermons/${params.id}`)}
            variant="plan"
            className="px-6 py-3 text-base"
          >
            {t("plan.workOnSermon")}
          </Button>
          <Button
            onClick={() => router.push(`/sermons/${params.id}/structure`)}
            variant="structure"
            className="px-6 py-3 text-base"
          >
            {t("plan.workOnStructure")}
          </Button>
        </div>
      </div>
    );
  }

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
        params={{ id: params.id as string }}
        sermonId={sermonId}
        t={t}
        combinedPlan={combinedPlan}
        noContentText={noContentText}
        planStyle={planStyle}
        setPlanStyle={setPlanStyle}
        isLoading={isLoading}
        generatingId={generatingId}
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
        onThoughtUpdate={handleThoughtUpdate}
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
