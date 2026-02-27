"use client";

import { useIsRestoring } from "@tanstack/react-query";
import { FileText, Key, Lightbulb, List, Maximize2, Minimize2, Pencil, Save, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import TextareaAutosize from "react-textarea-autosize";
import remarkGfm from "remark-gfm";

import { PlanStyle } from "@/api/clients/openAI.client";
import ExportButtons from "@/components/ExportButtons";
import FloatingTextScaleControls from "@/components/FloatingTextScaleControls";
import { SwitchViewIcon } from "@/components/Icons";
import Breadcrumbs from "@/components/navigation/Breadcrumbs";
import KeyFragmentsModal from "@/components/plan/KeyFragmentsModal";
import PlanStyleSelector from "@/components/plan/PlanStyleSelector";
import { ProgressSidebar } from "@/components/plan/ProgressSidebar";
import ViewPlanMenu from "@/components/plan/ViewPlanMenu";
import PreachingTimer from "@/components/PreachingTimer";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import useSermon from "@/hooks/useSermon";
import { SermonPoint, Sermon, Thought, Plan } from "@/models/models";
import { TimerPhase } from "@/types/TimerState";
import { debugLog } from "@/utils/debugMode";
import { sanitizeMarkdown } from "@/utils/markdownUtils";
import { hasPlan } from "@/utils/sermonPlanAccess";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import { getThoughtsForOutlinePoint } from "@/utils/thoughtOrdering";
import MarkdownDisplay from "@components/MarkdownDisplay";

import { buildSectionOutlineMarkdown } from "./buildSectionOutlineMarkdown";
import {
  SECTION_NAMES,
  TRANSLATION_KEYS,
  TRANSLATION_SECTIONS_CONCLUSION,
  TRANSLATION_SECTIONS_MAIN,
} from "./constants";
import PlanCopyButton from "./PlanCopyButton";
import PlanMarkdownGlobalStyles from "./PlanMarkdownGlobalStyles";
import { buildPlanOutlineLookup, getPointFromLookup, getPointSectionFromLookup } from "./planOutlineLookup";
import useCopyFormattedContent from "./useCopyFormattedContent";
import usePairedPlanCardHeights from "./usePairedPlanCardHeights";
import usePlanActions from "./usePlanActions";
import usePlanViewMode from "./usePlanViewMode";

import type {
  CombinedPlan,
  CopyStatus,
  PlanSectionContent,
  PlanTimerState,
  PlanViewMode,
  RegisterPairedCardRef,
  SectionColors,
  SermonSectionKey,
} from "./types";

// Custom UI components
const Card = React.forwardRef<HTMLDivElement, { className?: string, children: React.ReactNode }>(
  ({ className, children }, ref) => (
    <div
      ref={ref}
      className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow ${className || ''}`}
    >
      {children}
    </div>
  )
);
Card.displayName = 'Card';

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

// Section header spanning both columns with clear column labels
const SectionHeader = ({ section, onSwitchPage }: { section: 'introduction' | 'main' | 'conclusion'; onSwitchPage?: () => void }) => {
  const { t } = useTranslation();
  const themeSection = section === 'main' ? 'mainPart' : section; // map to theme colors
  const colors = SERMON_SECTION_COLORS[themeSection as 'introduction' | 'mainPart' | 'conclusion'];
  return (
    <div className={`lg:col-span-2 rounded-lg overflow-hidden border ${colors.border} dark:${colors.darkBorder} ${colors.bg} dark:${colors.darkBg}`}>
      <div
        className={`p-3 border-b border-l-4 ${colors.border} dark:${colors.darkBorder} flex justify-between items-start`}
        style={{ borderLeftColor: colors.light }}
      >
        <div>
          <h2 className={`text-xl font-semibold ${colors.text} dark:${colors.darkText}`}>
            {t(`sections.${section}`)}
          </h2>
        </div>
        {onSwitchPage && (
          <button
            onClick={onSwitchPage}
            className="group p-1 bg-white/20 rounded-full border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-300"
            title={t('plan.switchToStructure', { defaultValue: 'Switch to ThoughtsBySection view' })}
            aria-label={t('plan.switchToStructure', { defaultValue: 'Switch to ThoughtsBySection view' })}
          >
            <SwitchViewIcon className={`h-4 w-4 ${colors.text} dark:${colors.darkText} group-hover:text-gray-900 dark:group-hover:text-gray-100`} />
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-3 px-3 pb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 text-gray-800 dark:bg-gray-800 dark:text-gray-100 text-xs font-semibold shadow-sm">
            <Lightbulb className="h-4 w-4" />
            {t('plan.columns.thoughts')}
          </span>
        </div>
        <div className="flex items-center justify-start lg:justify-end gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 text-gray-800 dark:bg-gray-800 dark:text-gray-100 text-xs font-semibold shadow-sm">
            <List className="h-4 w-4" />
            {t('plan.columns.plan')}
          </span>
        </div>
      </div>
    </div>
  );
};

const MarkdownRenderer = ({ markdown, section }: { markdown: string, section?: 'introduction' | 'main' | 'conclusion' }) => {
  const sectionClass = section ? `prose-${section}` : '';
  const sectionDivClass = section ? `${section}-section` : '';

  // Sanitize the markdown content
  const sanitizedMarkdown = sanitizeMarkdown(markdown);

  return (
    <div className={`prose prose-sm md:prose-base dark:prose-invert max-w-none markdown-content prose-scaled ${sectionClass} ${sectionDivClass}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {sanitizedMarkdown}
      </ReactMarkdown>
    </div>
  );
};

interface FullPlanContentProps {
  sermonTitle?: string;
  sermonVerse?: string;
  combinedPlan: CombinedPlan;
  t: (key: string, options?: Record<string, unknown>) => string;
  timerState?: PlanTimerState | null;
  isPreachingMode?: boolean;
  noContentText: string;
}

const FullPlanContent = ({ sermonTitle, sermonVerse, combinedPlan, t, timerState, isPreachingMode, noContentText }: FullPlanContentProps) => {
  // Helper function to check if a phase is completed
  const checkPhaseCompleted = useCallback((phase: TimerPhase, currentPhase: TimerPhase): boolean => {
    const phaseOrder: TimerPhase[] = ['introduction', 'main', 'conclusion', 'finished'];
    const phaseIndex = phaseOrder.indexOf(phase);
    const currentIndex = phaseOrder.indexOf(currentPhase);
    return phaseIndex < currentIndex;
  }, []);
  const [completingPhase, setCompletingPhase] = useState<TimerPhase | null>(null);

  // Track phase changes to trigger completion animation
  const prevTimerStateRef = useRef<{ currentPhase: TimerPhase; phaseProgress: number; totalProgress: number } | null>(null);
  useEffect(() => {
    if (timerState && prevTimerStateRef.current &&
      timerState.currentPhase !== prevTimerStateRef.current.currentPhase &&
      checkPhaseCompleted(prevTimerStateRef.current.currentPhase, timerState.currentPhase)) {
      // Phase changed - trigger completion animation for previous phase
      setCompletingPhase(prevTimerStateRef.current.currentPhase);
      const timer = setTimeout(() => {
        setCompletingPhase(null);
      }, 300); // Match CSS animation duration
      return () => clearTimeout(timer);
    }
    prevTimerStateRef.current = timerState || null;
  }, [timerState, checkPhaseCompleted]);

  // Calculate clip-path for each section's progress overlay (fill from top to bottom)
  const getProgressClipPath = useCallback((phase: TimerPhase): string => {
    if (!timerState) return 'inset(0 0 100% 0)'; // Nothing visible

    const byPhase = timerState.phaseProgressByPhase;
    const value = phase === 'introduction'
      ? byPhase.introduction
      : phase === 'main'
        ? byPhase.main
        : byPhase.conclusion;
    const progressPercent = Math.min(Math.max(value, 0), 1) * 100;

    // For top-to-bottom filling: inset(0 0 X% 0) where X is the percentage to hide from bottom
    const hideFromBottom = 100 - progressPercent;
    const result = `inset(0 0 ${hideFromBottom}% 0)`;

    return result;
  }, [timerState]);

  // Get CSS classes for progress overlay including animation state
  const getProgressOverlayClasses = useCallback((phase: TimerPhase): string => {
    const baseClasses = 'progress-overlay';

    if (phase === 'introduction') {
      return `${baseClasses} progress-overlay-introduction${completingPhase === 'introduction' ? ' completing' : ''}`;
    } else if (phase === 'main') {
      return `${baseClasses} progress-overlay-main${completingPhase === 'main' ? ' completing' : ''}`;
    } else if (phase === 'conclusion') {
      return `${baseClasses} progress-overlay-conclusion${completingPhase === 'conclusion' ? ' completing' : ''}`;
    }
    return baseClasses;
  }, [completingPhase]);

  // Force disable CSS transitions for completed phases using inline styles
  const getProgressOverlayStyles = useCallback((phase: TimerPhase): React.CSSProperties => {
    if (!timerState) return {};

    const currentPhase = timerState.currentPhase;

    // For completed phases, disable CSS transitions completely via inline styles
    const isCompleted = (
      (phase === 'introduction' && ['main', 'conclusion', 'finished'].includes(currentPhase)) ||
      (phase === 'main' && ['conclusion', 'finished'].includes(currentPhase)) ||
      (phase === 'conclusion' && currentPhase === 'finished')
    );

    if (isCompleted) {
      // Allow instant completing animation for smooth transitions
      const isCompleting = completingPhase === phase;

      return {
        transition: 'none',
        animation: isCompleting ? 'progressFill 0s ease-out forwards' : 'none'
      };
    }

    return {};
  }, [timerState, completingPhase]);

  // Get accessibility attributes for progress overlay
  const getProgressAriaAttributes = useCallback((phase: TimerPhase) => {
    if (!timerState) return {};

    const byPhase = timerState.phaseProgressByPhase;
    const value = phase === 'introduction'
      ? byPhase.introduction
      : phase === 'main'
        ? byPhase.main
        : byPhase.conclusion;
    const progressValue = Math.round(Math.min(Math.max(value, 0), 1) * 100);

    let ariaLabel = '';
    switch (phase) {
      case 'introduction':
        ariaLabel = t('plan.progress.introduction', { defaultValue: 'Introduction progress: {progress}% complete' });
        break;
      case 'main':
        ariaLabel = t('plan.progress.main', { defaultValue: 'Main part progress: {progress}% complete' });
        break;
      case 'conclusion':
        ariaLabel = t('plan.progress.conclusion', { defaultValue: 'Conclusion progress: {progress}% complete' });
        break;
    }

    return {
      role: 'progressbar',
      'aria-valuenow': progressValue,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-label': ariaLabel.replace('{progress}', progressValue.toString()),
    };
  }, [timerState, t]);

  return (
    <>
      {sermonTitle && isPreachingMode && (
        <div className="mb-4">
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            {sermonTitle}
          </h1>
        </div>
      )}
      {sermonVerse && (
        <div className={`mb-8 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-md border-l-4 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
          <p className="text-gray-700 dark:text-gray-300 italic text-lg whitespace-pre-line">
            {sermonVerse}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {t(TRANSLATION_KEYS.COMMON.SCRIPTURE)}
          </p>
        </div>
      )}

      <div data-section={SECTION_NAMES.INTRODUCTION} className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} relative overflow-hidden rounded-lg`}>
        {/* Progress overlay for introduction */}
        {timerState && (
          <div
            className={getProgressOverlayClasses('introduction')}
            style={{
              clipPath: getProgressClipPath('introduction'),
              ...getProgressOverlayStyles('introduction')
            }}
            {...getProgressAriaAttributes('introduction')}
          />
        )}
        <h2 className={`relative z-10 text-2xl font-bold ${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText} mb-4 pb-2 border-b ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
          {t(TRANSLATION_KEYS.SECTIONS.INTRODUCTION)}
        </h2>
        <div className={`relative z-10 pl-2 border-l-4 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} prose-introduction`}>
          <MarkdownRenderer
            markdown={combinedPlan.introduction || t(TRANSLATION_KEYS.NO_CONTENT)}
            section={SECTION_NAMES.INTRODUCTION}
          />
        </div>
      </div>

      <div data-section={SECTION_NAMES.MAIN} className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} relative overflow-hidden rounded-lg`}>
        {/* Progress overlay for main */}
        {timerState && (
          <div
            className={getProgressOverlayClasses('main')}
            style={{
              clipPath: getProgressClipPath('main'),
              ...getProgressOverlayStyles('main')
            }}
            {...getProgressAriaAttributes('main')}
          />
        )}
        <h2 className={`relative z-10 text-2xl font-bold ${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText} mb-4 pb-2 border-b ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder}`}>
          {t(TRANSLATION_SECTIONS_MAIN)}
        </h2>
        <div className={`relative z-10 pl-2 border-l-4 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} prose-main`}>
          <MarkdownRenderer
            markdown={combinedPlan.main || noContentText}
            section={SECTION_NAMES.MAIN}
          />
        </div>
      </div>

      <div data-section={SECTION_NAMES.CONCLUSION} className={`mb-4 relative overflow-hidden rounded-lg`}>
        {/* Progress overlay for conclusion */}
        {timerState && (
          <div
            className={getProgressOverlayClasses('conclusion')}
            style={{ clipPath: getProgressClipPath('conclusion') }}
            {...getProgressAriaAttributes('conclusion')}
          />
        )}
        <h2 className={`relative z-10 text-2xl font-bold ${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText} mb-4 pb-2 border-b ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder}`}>
          {t(TRANSLATION_SECTIONS_CONCLUSION)}
        </h2>
        <div className={`relative z-10 pl-2 border-l-4 ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder} prose-conclusion`}>
          <MarkdownRenderer
            markdown={combinedPlan.conclusion || noContentText}
            section={SECTION_NAMES.CONCLUSION}
          />
        </div>
      </div>
    </>
  );
};

interface SermonPointCardProps {
  outlinePoint: SermonPoint;
  thoughts: Thought[];
  sectionName: string;
  onGenerate: (outlinePointId: string) => Promise<void>;
  generatedContent: string | null;
  isGenerating: boolean;
  sermonId: string;
  onOpenFragmentsModal: (outlinePointId: string) => void;
}

const SermonPointCard = React.forwardRef<HTMLDivElement, SermonPointCardProps>(({
  outlinePoint,
  thoughts,
  sectionName,
  onGenerate,
  generatedContent,
  isGenerating,
  onOpenFragmentsModal,
}, ref) => {
  const { t } = useTranslation();

  // Map the API section name to the theme section name
  const themeSectionName = sectionName === 'main' ? 'mainPart' : sectionName as 'introduction' | 'mainPart' | 'conclusion';

  // Get the colors for this section
  const sectionColors = SERMON_SECTION_COLORS[themeSectionName];

  // Count key fragments across all thoughts for this outline point
  const keyFragmentsCount = thoughts.reduce((count, thought) => {
    return count + (thought.keyFragments?.length || 0);
  }, 0);

  return (
    <Card
      ref={ref}
      className={`mb-4 p-4 border-${sectionColors.base.replace('#', '').substring(0, 3)} bg-white dark:bg-gray-800`}
    >
      <h3 className={`font-semibold text-lg mb-2 text-${sectionColors.text.split('-')[1]} flex justify-between items-center`}>
        {outlinePoint.text}
        <div className="flex gap-2">
          <Button
            onClick={() => onOpenFragmentsModal(outlinePoint.id)}
            variant="section"
            sectionColor={sectionColors}
            className="text-sm px-2 py-1 h-8 relative"
            title={t("plan.markKeyFragments")}
          >
            <Key className="h-4 w-4" />
            {keyFragmentsCount > 0 && (
              <span className="absolute -top-1 -right-1 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold border"
                style={{ borderColor: sectionColors.light }}
              >
                {keyFragmentsCount}
              </span>
            )}
          </Button>
          <Button
            onClick={() => onGenerate(outlinePoint.id)}
            variant="section"
            sectionColor={sectionColors}
            className="text-sm px-2 py-1 h-8"
            disabled={isGenerating}
            title={isGenerating ? t("plan.generating") : generatedContent ? t("plan.regenerate") : t("plan.generate")}
          >
            {isGenerating ? (
              <LoadingSpinner size="small" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>
        </div>
      </h3>

      <div className="mb-3">
        <ul className="mt-2 ml-4 text-base">
          {thoughts.map((thought) => (
            <li key={thought.id} className="mb-3 text-gray-700 dark:text-gray-300 leading-relaxed text-base flex items-start gap-2">
              <span className="mt-1.5">•</span>
              <div className="flex-1 min-w-0">
                <MarkdownDisplay content={thought.text} compact />
                {thought.keyFragments && thought.keyFragments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {thought.keyFragments.map((fragment, index) => (
                      <span
                        key={index}
                        className="inline-block px-2 py-0.5 text-xs rounded-full"
                        style={{ backgroundColor: sectionColors.light, color: sectionColors.dark }}
                      >
                        &quot;{fragment}&quot;
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {thoughts.length === 0 && (
          <p className="text-base text-gray-500 ml-4">{t("plan.noThoughts")}</p>
        )}
      </div>
    </Card>
  );
});
SermonPointCard.displayName = 'SermonPointCard';

interface PlanOutlinePointEditorProps {
  outlinePoint: SermonPoint;
  sectionKey: SermonSectionKey;
  sectionColors: SectionColors;
  generatedContent: Record<string, string>;
  modifiedContent: Record<string, boolean>;
  savedSermonPoints: Record<string, boolean>;
  editModePoints: Record<string, boolean>;
  noContentText: string;
  sermonPlanSection?: PlanSectionContent;
  t: (key: string, options?: Record<string, unknown>) => string;
  onSaveSermonPoint: (outlinePointId: string, content: string, section: keyof Plan) => Promise<void>;
  onToggleEditMode: (outlinePointId: string) => void;
  onSyncPairHeights: (section: SermonSectionKey, pointId: string) => void;
  onUpdateCombinedPlan: (outlinePointId: string, content: string, section: SermonSectionKey) => void;
  setGeneratedContent: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setModifiedContent: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

const PlanOutlinePointEditor = React.forwardRef<HTMLDivElement, PlanOutlinePointEditorProps>(({
  outlinePoint,
  sectionKey,
  sectionColors,
  generatedContent,
  modifiedContent,
  savedSermonPoints,
  editModePoints,
  noContentText,
  sermonPlanSection,
  t,
  onSaveSermonPoint,
  onToggleEditMode,
  onSyncPairHeights,
  onUpdateCombinedPlan,
  setGeneratedContent,
  setModifiedContent,
}, ref) => {
  const currentSavedContent = sermonPlanSection?.outlinePoints?.[outlinePoint.id] || "";

  return (
    <div
      ref={ref}
      key={outlinePoint.id}
      className="mb-4 bg-white dark:bg-gray-800 border rounded-lg p-4 shadow-sm"
    >
      <h3 className={`font-semibold text-lg mb-2 ${sectionColors.text} dark:${sectionColors.darkText} flex justify-between items-center`}>
        {outlinePoint.text}
        <div className="flex space-x-2">
          <Button
            className="text-sm px-2 py-1 h-8"
            onClick={() => onSaveSermonPoint(
              outlinePoint.id,
              generatedContent[outlinePoint.id] || "",
              sectionKey
            )}
            variant={modifiedContent[outlinePoint.id] ? "section" : "default"}
            sectionColor={modifiedContent[outlinePoint.id] ? sectionColors : undefined}
            disabled={
              !generatedContent[outlinePoint.id] ||
              generatedContent[outlinePoint.id].trim() === "" ||
              (savedSermonPoints[outlinePoint.id] && !modifiedContent[outlinePoint.id])
            }
            title={t("plan.save")}
          >
            <Save className="h-4 w-4" />
          </Button>
        </div>
      </h3>

      <div className="relative">
        <Button
          className="absolute top-2 right-2 z-10 text-sm px-2 py-1 h-8"
          onClick={() => onToggleEditMode(outlinePoint.id)}
          variant="default"
          title={editModePoints[outlinePoint.id] ? t(TRANSLATION_KEYS.PLAN.VIEW_MODE) : t(TRANSLATION_KEYS.PLAN.EDIT_MODE)}
        >
          {editModePoints[outlinePoint.id] ? (
            <FileText className="h-4 w-4" />
          ) : (
            <Pencil className="h-4 w-4" />
          )}
        </Button>
        {editModePoints[outlinePoint.id] ? (
          <TextareaAutosize
            className="w-full p-3 border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white text-base"
            minRows={4}
            placeholder={noContentText}
            value={generatedContent[outlinePoint.id] || ""}
            onChange={(e) => {
              const newContent = e.target.value;
              const isModified = newContent !== currentSavedContent;

              setGeneratedContent((prev) => ({
                ...prev,
                [outlinePoint.id]: newContent,
              }));

              setModifiedContent(prev => ({
                ...prev,
                [outlinePoint.id]: isModified
              }));

              onUpdateCombinedPlan(outlinePoint.id, newContent, sectionKey);

              // Keep pair heights aligned during active typing, not only on textarea auto-resize callbacks.
              onSyncPairHeights(sectionKey, outlinePoint.id);
            }}
            onHeightChange={() => {
              onSyncPairHeights(sectionKey, outlinePoint.id);
            }}
          />
        ) : (
          <div className="relative border rounded-md dark:bg-gray-700 dark:border-gray-600 text-base min-h-[100px]">
            <div className="absolute top-2 right-2 z-10">
              <Button
                className="text-sm px-2 py-1 h-8"
                onClick={() => onToggleEditMode(outlinePoint.id)}
                variant="default"
                title={t(TRANSLATION_KEYS.PLAN.EDIT_MODE)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-3 pr-12">
              <MarkdownRenderer
                markdown={generatedContent[outlinePoint.id] || noContentText}
                section={sectionKey}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
PlanOutlinePointEditor.displayName = 'PlanOutlinePointEditor';

interface PlanSectionColumnsProps {
  sectionKey: SermonSectionKey;
  outlinePoints?: SermonPoint[];
  sectionColors: SectionColors;
  leftTestId: string;
  rightTestId: string;
  registerPairRef: RegisterPairedCardRef;
  generatedContent: Record<string, string>;
  generatingId: string | null;
  sermonId: string;
  noContentText: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  modifiedContent: Record<string, boolean>;
  savedSermonPoints: Record<string, boolean>;
  editModePoints: Record<string, boolean>;
  sermonPlanSection?: PlanSectionContent;
  getThoughtsForSermonPoint: (outlinePointId: string) => Thought[];
  onGenerate: (outlinePointId: string) => Promise<void>;
  onOpenFragmentsModal: (outlinePointId: string) => void;
  onSaveSermonPoint: (outlinePointId: string, content: string, section: keyof Plan) => Promise<void>;
  onToggleEditMode: (outlinePointId: string) => void;
  onSyncPairHeights: (section: SermonSectionKey, pointId: string) => void;
  onUpdateCombinedPlan: (outlinePointId: string, content: string, section: SermonSectionKey) => void;
  setGeneratedContent: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setModifiedContent: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

const PlanSectionColumns = ({
  sectionKey,
  outlinePoints,
  sectionColors,
  leftTestId,
  rightTestId,
  registerPairRef,
  generatedContent,
  generatingId,
  sermonId,
  noContentText,
  t,
  modifiedContent,
  savedSermonPoints,
  editModePoints,
  sermonPlanSection,
  getThoughtsForSermonPoint,
  onGenerate,
  onOpenFragmentsModal,
  onSaveSermonPoint,
  onToggleEditMode,
  onSyncPairHeights,
  onUpdateCombinedPlan,
  setGeneratedContent,
  setModifiedContent,
}: PlanSectionColumnsProps) => {
  const points = outlinePoints ?? [];
  return (
    <>
      <div
        data-testid={leftTestId}
        className={`rounded-lg overflow-hidden border ${sectionColors.border.split(' ')[0]} dark:${sectionColors.darkBorder} ${sectionColors.bg} dark:${sectionColors.darkBg}`}
      >
        <div className="p-3">
          {points.map((outlinePoint) => (
            <SermonPointCard
              key={outlinePoint.id}
              ref={(el) => registerPairRef(sectionKey, outlinePoint.id, "left", el)}
              outlinePoint={outlinePoint}
              thoughts={getThoughtsForSermonPoint(outlinePoint.id)}
              sectionName={sectionKey}
              onGenerate={onGenerate}
              generatedContent={generatedContent[outlinePoint.id] || null}
              isGenerating={generatingId === outlinePoint.id}
              sermonId={sermonId}
              onOpenFragmentsModal={onOpenFragmentsModal}
            />
          ))}
          {outlinePoints?.length === 0 && (
            <p className="text-gray-500">{t(TRANSLATION_KEYS.PLAN.NO_SERMON_POINTS)}</p>
          )}
        </div>
      </div>

      <div
        data-testid={rightTestId}
        className={`rounded-lg overflow-hidden border ${sectionColors.border.split(' ')[0]} dark:${sectionColors.darkBorder} ${sectionColors.bg} dark:${sectionColors.darkBg}`}
      >
        <div className="p-3">
          {points.map((outlinePoint) => (
            <PlanOutlinePointEditor
              key={outlinePoint.id}
              ref={(el) => registerPairRef(sectionKey, outlinePoint.id, "right", el)}
              outlinePoint={outlinePoint}
              sectionKey={sectionKey}
              sectionColors={sectionColors}
              generatedContent={generatedContent}
              modifiedContent={modifiedContent}
              savedSermonPoints={savedSermonPoints}
              editModePoints={editModePoints}
              noContentText={noContentText}
              sermonPlanSection={sermonPlanSection}
              t={t}
              onSaveSermonPoint={onSaveSermonPoint}
              onToggleEditMode={onToggleEditMode}
              onSyncPairHeights={onSyncPairHeights}
              onUpdateCombinedPlan={onUpdateCombinedPlan}
              setGeneratedContent={setGeneratedContent}
              setModifiedContent={setModifiedContent}
            />
          ))}
          {outlinePoints?.length === 0 && (
            <p className="text-gray-500">{t(TRANSLATION_KEYS.PLAN.NO_SERMON_POINTS)}</p>
          )}
        </div>
      </div>
    </>
  );
};

interface PlanSectionBlockProps {
  sectionKey: SermonSectionKey;
  outlinePoints?: SermonPoint[];
  sectionColors: SectionColors;
  sectionRef: React.RefObject<HTMLDivElement | null>;
  leftTestId: string;
  rightTestId: string;
  showPlanStyleSelector?: boolean;
  planStyle: PlanStyle;
  setPlanStyle: React.Dispatch<React.SetStateAction<PlanStyle>>;
  isLoading: boolean;
  generatingId: string | null;
  registerPairRef: RegisterPairedCardRef;
  generatedContent: Record<string, string>;
  sermonId: string;
  noContentText: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  modifiedContent: Record<string, boolean>;
  savedSermonPoints: Record<string, boolean>;
  editModePoints: Record<string, boolean>;
  sermonPlanSection?: PlanSectionContent;
  getThoughtsForSermonPoint: (outlinePointId: string) => Thought[];
  onGenerate: (outlinePointId: string) => Promise<void>;
  onOpenFragmentsModal: (outlinePointId: string) => void;
  onSaveSermonPoint: (outlinePointId: string, content: string, section: keyof Plan) => Promise<void>;
  onToggleEditMode: (outlinePointId: string) => void;
  onSyncPairHeights: (section: SermonSectionKey, pointId: string) => void;
  onUpdateCombinedPlan: (outlinePointId: string, content: string, section: SermonSectionKey) => void;
  setGeneratedContent: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setModifiedContent: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSwitchToStructure: () => void;
}

const PlanSectionBlock = ({
  sectionKey,
  outlinePoints,
  sectionColors,
  sectionRef,
  leftTestId,
  rightTestId,
  showPlanStyleSelector = false,
  planStyle,
  setPlanStyle,
  isLoading,
  generatingId,
  registerPairRef,
  generatedContent,
  sermonId,
  noContentText,
  t,
  modifiedContent,
  savedSermonPoints,
  editModePoints,
  sermonPlanSection,
  getThoughtsForSermonPoint,
  onGenerate,
  onOpenFragmentsModal,
  onSaveSermonPoint,
  onToggleEditMode,
  onSyncPairHeights,
  onUpdateCombinedPlan,
  setGeneratedContent,
  setModifiedContent,
  onSwitchToStructure,
}: PlanSectionBlockProps) => {
  return (
    <>
      <div ref={sectionRef} data-section={sectionKey} className="lg:col-span-2">
        {showPlanStyleSelector && (
          <PlanStyleSelector
            value={planStyle}
            onChange={setPlanStyle}
            disabled={isLoading || !!generatingId}
          />
        )}

        <SectionHeader
          section={sectionKey}
          onSwitchPage={onSwitchToStructure}
        />
      </div>
      <PlanSectionColumns
        sectionKey={sectionKey}
        outlinePoints={outlinePoints}
        sectionColors={sectionColors}
        leftTestId={leftTestId}
        rightTestId={rightTestId}
        registerPairRef={registerPairRef}
        generatedContent={generatedContent}
        generatingId={generatingId}
        sermonId={sermonId}
        noContentText={noContentText}
        t={t}
        modifiedContent={modifiedContent}
        savedSermonPoints={savedSermonPoints}
        editModePoints={editModePoints}
        sermonPlanSection={sermonPlanSection}
        getThoughtsForSermonPoint={getThoughtsForSermonPoint}
        onGenerate={onGenerate}
        onOpenFragmentsModal={onOpenFragmentsModal}
        onSaveSermonPoint={onSaveSermonPoint}
        onToggleEditMode={onToggleEditMode}
        onSyncPairHeights={onSyncPairHeights}
        onUpdateCombinedPlan={onUpdateCombinedPlan}
        setGeneratedContent={setGeneratedContent}
        setModifiedContent={setModifiedContent}
      />
    </>
  );
};

interface PlanMainLayoutProps {
  sermon: Sermon;
  params: { id: string };
  sermonId: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  combinedPlan: CombinedPlan;
  noContentText: string;
  planStyle: PlanStyle;
  setPlanStyle: React.Dispatch<React.SetStateAction<PlanStyle>>;
  isLoading: boolean;
  generatingId: string | null;
  sectionMenuRef: React.RefObject<HTMLDivElement | null>;
  showSectionMenu: boolean;
  setShowSectionMenu: React.Dispatch<React.SetStateAction<boolean>>;
  registerPairRef: RegisterPairedCardRef;
  introductionSectionRef: React.RefObject<HTMLDivElement | null>;
  mainSectionRef: React.RefObject<HTMLDivElement | null>;
  conclusionSectionRef: React.RefObject<HTMLDivElement | null>;
  generatedContent: Record<string, string>;
  modifiedContent: Record<string, boolean>;
  savedSermonPoints: Record<string, boolean>;
  editModePoints: Record<string, boolean>;
  modalSermonPointId: string | null;
  setModalSermonPointId: React.Dispatch<React.SetStateAction<string | null>>;
  findSermonPointById: (outlinePointId: string) => SermonPoint | undefined;
  onThoughtUpdate: (updatedThought: Thought) => void;
  getThoughtsForSermonPoint: (outlinePointId: string) => Thought[];
  onGenerate: (outlinePointId: string) => Promise<void>;
  onSaveSermonPoint: (outlinePointId: string, content: string, section: keyof Plan) => Promise<void>;
  onToggleEditMode: (outlinePointId: string) => void;
  onSyncPairHeights: (section: SermonSectionKey, pointId: string) => void;
  onUpdateCombinedPlan: (outlinePointId: string, content: string, section: SermonSectionKey) => void;
  setGeneratedContent: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setModifiedContent: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSwitchToStructure: () => void;
  onRequestPlanOverlay: () => void;
  onRequestPreachingMode: () => void;
  onStartPreachingMode: () => void;
  getExportContent: (format: 'plain' | 'markdown') => Promise<string>;
  getPdfContent: () => Promise<React.ReactNode>;
}

const PlanMainLayout = ({
  sermon,
  params,
  sermonId,
  t,
  combinedPlan,
  noContentText,
  planStyle,
  setPlanStyle,
  isLoading,
  generatingId,
  sectionMenuRef,
  showSectionMenu,
  setShowSectionMenu,
  registerPairRef,
  introductionSectionRef,
  mainSectionRef,
  conclusionSectionRef,
  generatedContent,
  modifiedContent,
  savedSermonPoints,
  editModePoints,
  modalSermonPointId,
  setModalSermonPointId,
  findSermonPointById,
  onThoughtUpdate,
  getThoughtsForSermonPoint,
  onGenerate,
  onSaveSermonPoint,
  onToggleEditMode,
  onSyncPairHeights,
  onUpdateCombinedPlan,
  setGeneratedContent,
  setModifiedContent,
  onSwitchToStructure,
  onRequestPlanOverlay,
  onRequestPreachingMode,
  onStartPreachingMode,
  getExportContent,
  getPdfContent,
}: PlanMainLayoutProps) => {
  const introOutline = sermon.outline?.introduction;
  const mainOutline = sermon.outline?.main;
  const conclusionOutline = sermon.outline?.conclusion;

  return (
    <div
      className="p-4"
      data-testid="sermon-plan-page-container"
    >
      <ProgressSidebar
        outline={sermon.outline || { introduction: [], main: [], conclusion: [] }}
        savedSermonPoints={savedSermonPoints}
      />
      <PlanMarkdownGlobalStyles variant="main" />
      <div className="w-full">
        {/* Page Header */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center">
              <Link
                href={`/sermons/${params.id}`}
                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center mr-3"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {t("actions.backToSermon")}
              </Link>
            </div>
          </div>

          {/* Sermon Title & Verse */}
          {sermon && (
            <div className="mt-6 mb-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
              <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white mb-4">
                {sermon.title}
              </h1>
              {sermon.verse && (
                <div className="pl-4 border-l-4 border-blue-500 dark:border-blue-400">
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line text-lg italic">
                    {sermon.verse}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    {t(TRANSLATION_KEYS.COMMON.SCRIPTURE)}
                  </p>
                </div>
              )}

              {/* View Plan Buttons */}
              <div className="flex flex-wrap gap-3 mt-6">
                <ViewPlanMenu
                  sermonId={sermonId}
                  combinedPlan={combinedPlan}
                  sectionMenuRef={sectionMenuRef}
                  showSectionMenu={showSectionMenu}
                  setShowSectionMenu={setShowSectionMenu}
                  onRequestPlanOverlay={onRequestPlanOverlay}
                  onRequestPreachingMode={onRequestPreachingMode}
                  onStartPreachingMode={onStartPreachingMode}
                />

                {/* Add Export Buttons */}
                <ExportButtons
                  sermonId={sermonId}
                  getExportContent={getExportContent}
                  getPdfContent={getPdfContent}
                  title={sermon.title || "Sermon Plan"}
                  className="ml-auto"
                  disabledFormats={['pdf']}
                  planData={hasPlan(sermon) ? { ...combinedPlan, sermonTitle: sermon.title, sermonVerse: sermon.verse } : undefined}
                  sermonTitle={sermon.title}
                />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PlanSectionBlock
            sectionKey={SECTION_NAMES.INTRODUCTION}
            outlinePoints={introOutline}
            sectionColors={SERMON_SECTION_COLORS.introduction}
            sectionRef={introductionSectionRef}
            leftTestId="plan-introduction-left-section"
            rightTestId="plan-introduction-right-section"
            showPlanStyleSelector
            planStyle={planStyle}
            setPlanStyle={setPlanStyle}
            isLoading={isLoading}
            generatingId={generatingId}
            registerPairRef={registerPairRef}
            generatedContent={generatedContent}
            sermonId={sermonId}
            noContentText={noContentText}
            t={t}
            modifiedContent={modifiedContent}
            savedSermonPoints={savedSermonPoints}
            editModePoints={editModePoints}
            sermonPlanSection={sermon.plan?.introduction}
            getThoughtsForSermonPoint={getThoughtsForSermonPoint}
            onGenerate={onGenerate}
            onOpenFragmentsModal={setModalSermonPointId}
            onSaveSermonPoint={onSaveSermonPoint}
            onToggleEditMode={onToggleEditMode}
            onSyncPairHeights={onSyncPairHeights}
            onUpdateCombinedPlan={onUpdateCombinedPlan}
            setGeneratedContent={setGeneratedContent}
            setModifiedContent={setModifiedContent}
            onSwitchToStructure={onSwitchToStructure}
          />

          <PlanSectionBlock
            sectionKey={SECTION_NAMES.MAIN}
            outlinePoints={mainOutline}
            sectionColors={SERMON_SECTION_COLORS.mainPart}
            sectionRef={mainSectionRef}
            leftTestId="plan-main-left-section"
            rightTestId="plan-main-right-section"
            planStyle={planStyle}
            setPlanStyle={setPlanStyle}
            isLoading={isLoading}
            generatingId={generatingId}
            registerPairRef={registerPairRef}
            generatedContent={generatedContent}
            sermonId={sermonId}
            noContentText={noContentText}
            t={t}
            modifiedContent={modifiedContent}
            savedSermonPoints={savedSermonPoints}
            editModePoints={editModePoints}
            sermonPlanSection={sermon.plan?.main}
            getThoughtsForSermonPoint={getThoughtsForSermonPoint}
            onGenerate={onGenerate}
            onOpenFragmentsModal={setModalSermonPointId}
            onSaveSermonPoint={onSaveSermonPoint}
            onToggleEditMode={onToggleEditMode}
            onSyncPairHeights={onSyncPairHeights}
            onUpdateCombinedPlan={onUpdateCombinedPlan}
            setGeneratedContent={setGeneratedContent}
            setModifiedContent={setModifiedContent}
            onSwitchToStructure={onSwitchToStructure}
          />

          <PlanSectionBlock
            sectionKey={SECTION_NAMES.CONCLUSION}
            outlinePoints={conclusionOutline}
            sectionColors={SERMON_SECTION_COLORS.conclusion}
            sectionRef={conclusionSectionRef}
            leftTestId="plan-conclusion-left-section"
            rightTestId="plan-conclusion-right-section"
            planStyle={planStyle}
            setPlanStyle={setPlanStyle}
            isLoading={isLoading}
            generatingId={generatingId}
            registerPairRef={registerPairRef}
            generatedContent={generatedContent}
            sermonId={sermonId}
            noContentText={noContentText}
            t={t}
            modifiedContent={modifiedContent}
            savedSermonPoints={savedSermonPoints}
            editModePoints={editModePoints}
            sermonPlanSection={sermon.plan?.conclusion}
            getThoughtsForSermonPoint={getThoughtsForSermonPoint}
            onGenerate={onGenerate}
            onOpenFragmentsModal={setModalSermonPointId}
            onSaveSermonPoint={onSaveSermonPoint}
            onToggleEditMode={onToggleEditMode}
            onSyncPairHeights={onSyncPairHeights}
            onUpdateCombinedPlan={onUpdateCombinedPlan}
            setGeneratedContent={setGeneratedContent}
            setModifiedContent={setModifiedContent}
            onSwitchToStructure={onSwitchToStructure}
          />
        </div>

        {/* Key Fragments Modal */}
        {modalSermonPointId && (() => {
          const outlinePoint = findSermonPointById(modalSermonPointId);
          if (!outlinePoint) return null;
          return (
            <KeyFragmentsModal
              data-testid="key-fragments-modal-instance"
              isOpen={!!modalSermonPointId}
              onClose={() => setModalSermonPointId(null)}
              outlinePoint={outlinePoint}
              thoughts={getThoughtsForSermonPoint(modalSermonPointId)}
              sermonId={sermonId}
              onThoughtUpdate={onThoughtUpdate}
            />
          );
        })()}
      </div>
    </div>
  );
};

interface PlanImmersiveViewProps {
  sermon: Sermon;
  combinedPlan: CombinedPlan;
  t: (key: string, options?: Record<string, unknown>) => string;
  timerState: FullPlanContentProps['timerState'];
  isPreachingMode: boolean;
  noContentText: string;
  copyStatus: CopyStatus;
  immersiveContentRef: React.RefObject<HTMLDivElement | null>;
  onCopy: () => Promise<void>;
  onOpenPlanOverlay: () => void;
  onClosePlanView: () => void;
}

const PlanImmersiveView = ({
  sermon,
  combinedPlan,
  t,
  timerState,
  isPreachingMode,
  noContentText,
  copyStatus,
  immersiveContentRef,
  onCopy,
  onOpenPlanOverlay,
  onClosePlanView,
}: PlanImmersiveViewProps) => {
  return (
    <>
      <PlanMarkdownGlobalStyles variant="immersive" />
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900" data-testid="sermon-plan-immersive-view">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-4">
          <div>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{sermon.title}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("plan.pageTitle")}</p>
          </div>
          <div className="flex items-center gap-2 h-10">
            <PlanCopyButton status={copyStatus} onCopy={onCopy} t={t} />
            <button
              onClick={onOpenPlanOverlay}
              className="flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700"
              title={t("plan.exitFullscreen")}
            >
              <Minimize2 className="h-7 w-7" />
            </button>
            <button
              onClick={onClosePlanView}
              className="flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700"
              title={t("actions.close")}
            >
              <X className="h-7 w-7" />
            </button>
          </div>
        </div>
        <main className="flex-1 overflow-y-auto">
          <div ref={immersiveContentRef} className="max-w-5xl mx-auto px-6 py-8">
            <FullPlanContent
              sermonTitle={sermon.title}
              sermonVerse={sermon.verse}
              combinedPlan={combinedPlan}
              t={t}
              timerState={timerState}
              isPreachingMode={isPreachingMode}
              noContentText={noContentText}
            />
          </div>
        </main>
      </div>
    </>
  );
};

interface PlanPreachingViewProps {
  sermon: Sermon;
  combinedPlan: CombinedPlan;
  t: (key: string, options?: Record<string, unknown>) => string;
  timerState: FullPlanContentProps['timerState'];
  isPlanPreaching: boolean;
  planViewMode: PlanViewMode | null;
  noContentText: string;
  preachingDuration: number | null;
  onTimerStateChange: (timerState: PlanTimerState) => void;
  onTimerFinished: () => void;
  onSetDuration: (durationSeconds: number) => void;
}

const PlanPreachingView = ({
  sermon,
  combinedPlan,
  t,
  timerState,
  isPlanPreaching,
  planViewMode,
  noContentText,
  preachingDuration,
  onTimerStateChange,
  onTimerFinished,
  onSetDuration,
}: PlanPreachingViewProps) => {
  return (
    <>
      <PlanMarkdownGlobalStyles variant="preaching" />
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        {/* Sticky Timer Header - Always show in preaching mode */}
        <div className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">
          <PreachingTimer
            initialDuration={preachingDuration !== null ? preachingDuration : 0}
            className="border-0 shadow-none"
            onTimerStateChange={onTimerStateChange}
            onTimerFinished={onTimerFinished}
            onSetDuration={onSetDuration}
            exitFallbackPath={sermon?.id ? `/sermons/${sermon.id}` : undefined}
          />
        </div>

        {/* Floating Text Scale Controls */}
        <FloatingTextScaleControls />

        {/* Show plan content in preaching mode */}
        {planViewMode === "preaching" && (
          <main className="flex-1 overflow-y-auto pt-[115px] lg:pt-[65px]">
            <div className="preaching-content px-4 sm:px-6 pt-0 pb-8">
              <div className="mb-4 mt-0 lg:-mt-1">
                <Breadcrumbs forceShow={true} />
              </div>
              <FullPlanContent
                sermonTitle={sermon.title}
                sermonVerse={sermon.verse}
                combinedPlan={combinedPlan}
                t={t}
                timerState={timerState}
                isPreachingMode={isPlanPreaching}
                noContentText={noContentText}
              />
            </div>
          </main>
        )}
      </div>
    </>
  );
};

interface PlanOverlayPortalProps {
  isPlanOverlay: boolean;
  sermon: Sermon;
  combinedPlan: CombinedPlan;
  t: (key: string, options?: Record<string, unknown>) => string;
  timerState: FullPlanContentProps['timerState'];
  isPreachingMode: boolean;
  noContentText: string;
  copyStatus: CopyStatus;
  planOverlayContentRef: React.RefObject<HTMLDivElement | null>;
  onCopy: () => Promise<void>;
  onOpenPlanImmersive: () => void;
  onClosePlanView: () => void;
}

const PlanOverlayPortal = ({
  isPlanOverlay,
  sermon,
  combinedPlan,
  t,
  timerState,
  isPreachingMode,
  noContentText,
  copyStatus,
  planOverlayContentRef,
  onCopy,
  onOpenPlanImmersive,
  onClosePlanView,
}: PlanOverlayPortalProps) => {
  if (!isPlanOverlay || typeof document === 'undefined' || !sermon) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm" data-testid="sermon-plan-overlay">
      <div className="flex flex-1 justify-center p-4 overflow-y-auto">
        <div className="flex w-full flex-1 max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[calc(100vh-2rem)] min-h-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-900">
            <div>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{sermon.title}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("plan.pageTitle")}</p>
            </div>
            <div className="flex items-center gap-2 h-10">
              <PlanCopyButton status={copyStatus} onCopy={onCopy} t={t} />
              <button
                onClick={onOpenPlanImmersive}
                className="flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700"
                title={t("plan.fullscreen")}
              >
                <Maximize2 className="h-7 w-7" />
              </button>
              <button
                onClick={onClosePlanView}
                className="flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700"
                title={t("actions.close")}
              >
                <X className="h-7 w-7" />
              </button>
            </div >
          </div >
          <div ref={planOverlayContentRef} className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
            <FullPlanContent
              sermonTitle={sermon.title}
              sermonVerse={sermon.verse}
              combinedPlan={combinedPlan}
              t={t}
              timerState={timerState}
              isPreachingMode={isPreachingMode}
              noContentText={noContentText}
            />
          </div>
        </div >
      </div >
    </div >,
    document.body
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

  // Add syncInProgress flag to prevent recursive sync calls
  // const syncInProgressRef = useRef(false);

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

  // Find thoughts for an outline point
  // const findThoughtsForSermonPoint = (outlinePointId: string): Thought[] => {
  //   // Используем существующую функцию с учетом порядка из структуры
  //   return getThoughtsForSermonPoint(outlinePointId);
  // };

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
