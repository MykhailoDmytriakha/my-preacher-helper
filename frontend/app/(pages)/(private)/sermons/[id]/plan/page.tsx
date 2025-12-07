"use client";

import { useEffect, useState, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { useParams, useRouter, useSearchParams, usePathname } from "next/navigation";
import { getSermonById } from "@/services/sermon.service";
import { SermonPoint, Sermon, Thought, Plan, ThoughtsBySection } from "@/models/models";
import { TimerPhase } from "@/types/TimerState";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import TextareaAutosize from "react-textarea-autosize";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import Link from "next/link";
import React from "react";
import { createPortal } from "react-dom";
import { Save, Sparkles, FileText, Pencil, Key, Lightbulb, List, Maximize2, Copy, Minimize2, X, Check } from "lucide-react";
import { SwitchViewIcon } from "@/components/Icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import KeyFragmentsModal from "@/components/plan/KeyFragmentsModal";
import PlanStyleSelector from "@/components/plan/PlanStyleSelector";
import { PlanStyle } from "@/api/clients/openAI.client";

import ExportButtons from "@/components/ExportButtons";
import ViewPlanMenu from "@/components/plan/ViewPlanMenu";
import PreachingTimer from "@/components/PreachingTimer";
import { sanitizeMarkdown } from "@/utils/markdownUtils";
import FloatingTextScaleControls from "@/components/FloatingTextScaleControls";
import MarkdownDisplay from "@components/MarkdownDisplay";

type PlanViewMode = "overlay" | "immersive" | "preaching";

// Стиль для hover-эффекта кнопок с секционными цветами
const sectionButtonStyles = `
  .section-button {
    border: 1px solid transparent;
    transition: all 0.2s ease;
  }
  .section-button:hover {
    background-color: var(--hover-bg) !important;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
  .section-button:active {
    transform: translateY(0);
    background-color: var(--active-bg) !important;
    box-shadow: none;
  }
`;

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
  combinedPlan: {
    introduction: string;
    main: string;
    conclusion: string;
  };
  t: (key: string, options?: Record<string, unknown>) => string;
  timerState?: {
    currentPhase: TimerPhase;
    phaseProgress: number;
    totalProgress: number;
  } | null;
  isPreachingMode?: boolean;
}

const FullPlanContent = ({ sermonTitle, sermonVerse, combinedPlan, t, timerState, isPreachingMode }: FullPlanContentProps) => {
  const [completingPhase, setCompletingPhase] = useState<TimerPhase | null>(null);

  // Track phase changes to trigger completion animation
  const prevTimerStateRef = useRef<{ currentPhase: TimerPhase; phaseProgress: number; totalProgress: number } | null>(null);
  useEffect(() => {
    if (timerState && prevTimerStateRef.current &&
      timerState.currentPhase !== prevTimerStateRef.current.currentPhase &&
      isPhaseCompleted(prevTimerStateRef.current.currentPhase, timerState.currentPhase)) {
      // Phase changed - trigger completion animation for previous phase
      setCompletingPhase(prevTimerStateRef.current.currentPhase);
      const timer = setTimeout(() => {
        setCompletingPhase(null);
      }, 300); // Match CSS animation duration
      return () => clearTimeout(timer);
    }
    prevTimerStateRef.current = timerState || null;
  }, [timerState?.totalProgress]);

  // Calculate clip-path for each section's progress overlay (fill from top to bottom)
  const getProgressClipPath = useCallback((phase: TimerPhase): string => {
    if (!timerState) return 'inset(0 0 100% 0)'; // Nothing visible

    const totalProgress = timerState.totalProgress; // 0-1
    const currentPhase = timerState.currentPhase;
    const phaseProgress = timerState.phaseProgress; // Progress within current phase (0-1)
    let progressPercent = 0;


    // Use currentPhase to determine if a phase is completed, avoiding floating point precision issues
    // For active phases, use phaseProgress instead of totalProgress to handle skip operations correctly
    switch (phase) {
      case 'introduction':
        // Introduction is completed if currentPhase is main, conclusion, or finished
        if (['main', 'conclusion', 'finished'].includes(currentPhase)) {
          progressPercent = 100;
        } else if (currentPhase === 'introduction') {
          progressPercent = Math.min(totalProgress / 0.2, 1) * 100;
        }
        break;
      case 'main':
        // Main is completed if currentPhase is conclusion or finished
        if (['conclusion', 'finished'].includes(currentPhase)) {
          progressPercent = 100;
        } else if (currentPhase === 'main') {
          // Use phaseProgress for active phase - this handles skip correctly
          progressPercent = phaseProgress * 100;
        }
        break;
      case 'conclusion':
        // Conclusion is current if currentPhase is conclusion, completed if finished
        if (currentPhase === 'conclusion') {
          // Use phaseProgress for active phase - this handles skip correctly
          progressPercent = phaseProgress * 100;
        } else if (currentPhase === 'finished') {
          progressPercent = 100;
        }
        break;
    }

    // For top-to-bottom filling: inset(0 0 X% 0) where X is the percentage to hide from bottom
    const hideFromBottom = 100 - progressPercent;
    const result = `inset(0 0 ${hideFromBottom}% 0)`;

    return result;
  }, [timerState?.currentPhase, timerState?.totalProgress]);

  // Helper function to check if a phase is completed
  const isPhaseCompleted = useCallback((phase: TimerPhase, currentPhase: TimerPhase): boolean => {
    const phaseOrder: TimerPhase[] = ['introduction', 'main', 'conclusion', 'finished'];
    const phaseIndex = phaseOrder.indexOf(phase);
    const currentIndex = phaseOrder.indexOf(currentPhase);
    return phaseIndex < currentIndex;
  }, []);

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
  }, [timerState?.currentPhase, completingPhase]);

  // Get accessibility attributes for progress overlay
  const getProgressAriaAttributes = useCallback((phase: TimerPhase) => {
    if (!timerState) return {};

    let progressValue = 0;

    // Calculate progress value for accessibility
    if (phase === timerState.currentPhase) {
      progressValue = Math.round(timerState.phaseProgress * 100);
    } else if (isPhaseCompleted(phase, timerState.currentPhase)) {
      progressValue = 100;
    }

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
  }, [timerState?.currentPhase, timerState?.phaseProgress, timerState?.totalProgress, isPhaseCompleted, t]);

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
            {t("common.scripture")}
          </p>
        </div>
      )}

      <div data-section="introduction" className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} relative overflow-hidden rounded-lg`}>
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
          {t("sections.introduction")}
        </h2>
        <div className={`relative z-10 pl-2 border-l-4 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} prose-introduction`}>
          <MarkdownRenderer
            markdown={combinedPlan.introduction || t("plan.noContent")}
            section="introduction"
          />
        </div>
      </div>

      <div data-section="main" className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} relative overflow-hidden rounded-lg`}>
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
          {t("sections.main")}
        </h2>
        <div className={`relative z-10 pl-2 border-l-4 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} prose-main`}>
          <MarkdownRenderer
            markdown={combinedPlan.main || t("plan.noContent")}
            section="main"
          />
        </div>
      </div>

      <div data-section="conclusion" className={`mb-4 relative overflow-hidden rounded-lg`}>
        {/* Progress overlay for conclusion */}
        {timerState && (
          <div
            className={getProgressOverlayClasses('conclusion')}
            style={{ clipPath: getProgressClipPath('conclusion') }}
            {...getProgressAriaAttributes('conclusion')}
          />
        )}
        <h2 className={`relative z-10 text-2xl font-bold ${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText} mb-4 pb-2 border-b ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder}`}>
          {t("sections.conclusion")}
        </h2>
        <div className={`relative z-10 pl-2 border-l-4 ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder} prose-conclusion`}>
          <MarkdownRenderer
            markdown={combinedPlan.conclusion || t("plan.noContent")}
            section="conclusion"
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

// Add a debounce utility to prevent too frequent calls
function debounce<T extends (...args: unknown[]) => unknown>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function (...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export default function PlanPage() {
  const { t } = useTranslation();
  const params = useParams();
  const sermonId = params?.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const planViewParam = searchParams.get("planView");
  const planViewMode: PlanViewMode | null = useMemo(() => {
    if (planViewParam === "overlay" || planViewParam === "immersive" || planViewParam === "preaching") {
      return planViewParam;
    }
    return null;
  }, [planViewParam]);

  const updatePlanViewMode = useCallback((mode: PlanViewMode | null, { replace = true }: { replace?: boolean } = {}) => {
    if (!pathname) return;
    const paramsCopy = new URLSearchParams(searchParams.toString());
    if (mode) {
      paramsCopy.set("planView", mode);
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
  }, [pathname, router, searchParams]);

  // Handle switching to structure view
  const handleSwitchToStructure = useCallback(() => {
    router.push(`/sermons/${encodeURIComponent(sermonId)}/structure`);
  }, [sermonId, router]);

  const isPlanOverlay = planViewMode === "overlay";
  const isPlanImmersive = planViewMode === "immersive";
  const isPlanPreaching = planViewMode === "preaching";
  const copyButtonClasses = "flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700";
  const copyButtonStatusClasses: Record<CopyStatus, string> = {
    idle: '',
    copying: 'opacity-80 cursor-wait',
    success: 'border-2 border-green-500 bg-green-600 hover:bg-green-700',
    error: 'border-2 border-red-500 bg-red-600 hover:bg-red-700'
  };

  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generated content by outline point ID
  const [generatedContent, setGeneratedContent] = useState<Record<string, string>>({});
  // Currently generating outline point ID
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  // Style for plan generation
  const [planStyle, setPlanStyle] = useState<PlanStyle>('memory');

  // State to hold the combined generated content for each section
  const [combinedPlan, setCombinedPlan] = useState<{
    introduction: string;
    main: string;
    conclusion: string;
  }>({ introduction: '', main: '', conclusion: '' });

  // Refs for the outline point cards in each column
  const introPointRefs = useRef<Record<string, { left: HTMLDivElement | null, right: HTMLDivElement | null }>>({});
  const mainPointRefs = useRef<Record<string, { left: HTMLDivElement | null, right: HTMLDivElement | null }>>({});
  const conclusionPointRefs = useRef<Record<string, { left: HTMLDivElement | null, right: HTMLDivElement | null }>>({});
  const planOverlayContentRef = useRef<HTMLDivElement | null>(null);
  const immersiveContentRef = useRef<HTMLDivElement | null>(null);
  const overlayCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const immersiveCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  type CopyStatus = 'idle' | 'copying' | 'success' | 'error';
  const [overlayCopyStatus, setOverlayCopyStatus] = useState<CopyStatus>('idle');
  const [immersiveCopyStatus, setImmersiveCopyStatus] = useState<CopyStatus>('idle');

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

  const [preachingTimerState, setPreachingTimerState] = useState<{
    currentPhase: TimerPhase;
    phaseProgress: number;
    totalProgress: number;
  } | null>(null);

  const handleTimerStateChange = useCallback((timerState: {
    currentPhase: TimerPhase;
    phaseProgress: number;
    totalProgress: number;
    timeRemaining: number;
  }) => {
    // Helper function to format time
    const formatTime = (seconds: number): string => {
      const mins = Math.floor(Math.abs(seconds) / 60);
      const secs = Math.abs(seconds) % 60;
      const sign = seconds < 0 ? '-' : '';
      return `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Calculate progress for all phases in one place for consolidated logging
    const totalProgress = timerState.totalProgress;
    const currentPhase = timerState.currentPhase;
    const phaseProgress = timerState.phaseProgress;

    // Calculate progress percentages for each phase (same logic as getProgressClipPath)
    const getPhaseProgressPercent = (phase: TimerPhase): number => {
      switch (phase) {
        case 'introduction':
          if (['main', 'conclusion', 'finished'].includes(currentPhase)) {
            return 100;
          } else if (currentPhase === 'introduction') {
            return Math.min(totalProgress / 0.2, 1) * 100;
          }
          return 0;
        case 'main':
          if (['conclusion', 'finished'].includes(currentPhase)) {
            return 100;
          } else if (currentPhase === 'main') {
            return phaseProgress * 100;
          }
          return 0;
        case 'conclusion':
          if (currentPhase === 'conclusion') {
            return phaseProgress * 100;
          } else if (currentPhase === 'finished') {
            return 100;
          }
          return 0;
        default:
          return 0;
      }
    };

    const introProgress = getPhaseProgressPercent('introduction');
    const mainProgress = getPhaseProgressPercent('main');
    const conclusionProgress = getPhaseProgressPercent('conclusion');

    // Consolidated log showing all phases progress and current timer time
    console.log(`[TIMER] Phase:${timerState.currentPhase} | Intro:${introProgress.toFixed(1)}% | Main:${mainProgress.toFixed(1)}% | Conclusion:${conclusionProgress.toFixed(1)}% | Time:${formatTime(timerState.timeRemaining)} | Total:${(totalProgress * 100).toFixed(1)}%`);

    setPreachingTimerState(timerState);
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
    return () => {
      if (overlayCopyTimeoutRef.current) {
        clearTimeout(overlayCopyTimeoutRef.current);
      }
      if (immersiveCopyTimeoutRef.current) {
        clearTimeout(immersiveCopyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isPlanOverlay) {
      if (overlayCopyTimeoutRef.current) {
        clearTimeout(overlayCopyTimeoutRef.current);
        overlayCopyTimeoutRef.current = null;
      }
      setOverlayCopyStatus('idle');
    }
  }, [isPlanOverlay]);

  useEffect(() => {
    if (!isPlanImmersive) {
      if (immersiveCopyTimeoutRef.current) {
        clearTimeout(immersiveCopyTimeoutRef.current);
        immersiveCopyTimeoutRef.current = null;
      }
      setImmersiveCopyStatus('idle');
    }
  }, [isPlanImmersive]);

  // Function to synchronize heights
  const syncHeights = () => {
    // Always reset heights first
    const resetHeights = () => {
      Object.keys(introPointRefs.current).forEach(pointId => {
        const { left, right } = introPointRefs.current[pointId];
        if (left) left.style.height = 'auto';
        if (right) right.style.height = 'auto';
      });
      Object.keys(mainPointRefs.current).forEach(pointId => {
        const { left, right } = mainPointRefs.current[pointId];
        if (left) left.style.height = 'auto';
        if (right) right.style.height = 'auto';
      });
      Object.keys(conclusionPointRefs.current).forEach(pointId => {
        const { left, right } = conclusionPointRefs.current[pointId];
        if (left) left.style.height = 'auto';
        if (right) right.style.height = 'auto';
      });
    };

    resetHeights();

    // Only equalize heights on large screens (Tailwind lg: 1024px)
    if (typeof window === 'undefined') return;
    const isLarge = window.matchMedia('(min-width: 1024px)').matches;
    if (!isLarge) {
      // On mobile/tablet we leave heights as auto to avoid tall cards
      return;
    }

    // Force reflow to ensure natural heights are calculated
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    document.body.offsetHeight;

    const applyMaxHeights = (refs: React.MutableRefObject<Record<string, { left: HTMLDivElement | null, right: HTMLDivElement | null }>>) => {
      Object.keys(refs.current).forEach(pointId => {
        const { left, right } = refs.current[pointId];
        if (left && right) {
          const maxHeight = Math.max(left.offsetHeight, right.offsetHeight);
          left.style.height = `${maxHeight}px`;
          right.style.height = `${maxHeight}px`;
        }
      });
    };

    applyMaxHeights(introPointRefs);
    applyMaxHeights(mainPointRefs);
    applyMaxHeights(conclusionPointRefs);
  };

  // Create a debounced version of syncHeights with a 200ms delay
  const debouncedSyncHeights = useRef(debounce(syncHeights, 200)).current;

  // Helper: find section by outline point id
  const getSectionByPointId = (outlinePointId: string): 'introduction' | 'main' | 'conclusion' | null => {
    if (!sermon?.outline) return null;
    if (sermon.outline.introduction.some(op => op.id === outlinePointId)) return 'introduction';
    if (sermon.outline.main.some(op => op.id === outlinePointId)) return 'main';
    if (sermon.outline.conclusion.some(op => op.id === outlinePointId)) return 'conclusion';
    return null;
  };

  // Helper: choose refs storage for section
  const getRefsForSection = (
    section: 'introduction' | 'main' | 'conclusion'
  ): React.MutableRefObject<Record<string, { left: HTMLDivElement | null; right: HTMLDivElement | null }>> => {
    switch (section) {
      case 'introduction':
        return introPointRefs;
      case 'main':
        return mainPointRefs;
      case 'conclusion':
      default:
        return conclusionPointRefs;
    }
  };

  // Pair-specific height sync with double rAF to wait layout
  const syncPairHeights = (section: 'introduction' | 'main' | 'conclusion', pointId: string) => {
    if (typeof window === 'undefined') return;
    const refs = getRefsForSection(section);
    const pair = refs.current[pointId];
    if (!pair?.left || !pair?.right) return;

    // schedule after layout settles
    requestAnimationFrame(() => {
      // Reset to natural height for measurement
      pair.left!.style.height = 'auto';
      pair.right!.style.height = 'auto';

      requestAnimationFrame(() => {
        const lh = pair.left!.offsetHeight;
        const rh = pair.right!.offsetHeight;
        const max = Math.max(lh, rh);
        pair.left!.style.height = `${max}px`;
        pair.right!.style.height = `${max}px`;
      });
    });
  };

  const syncPairHeightsByPointId = (pointId: string) => {
    const section = getSectionByPointId(pointId);
    if (section) {
      syncPairHeights(section, pointId);
    }
  };

  // Initial sync after outline renders (no MutationObserver)
  useEffect(() => {
    const timer = setTimeout(() => {
      syncHeights();
    }, 150);
    return () => clearTimeout(timer);
  }, [sermon?.outline]);

  // Keep heights correct when resizing across breakpoints
  useEffect(() => {
    const onResize = () => debouncedSyncHeights();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onResize);
      }
    };
  }, [debouncedSyncHeights]);

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

  // Load the sermon
  useEffect(() => {
    async function loadSermon() {
      setIsLoading(true);
      try {
        const sermonData = await getSermonById(sermonId);

        if (!sermonData) {
          setError(t("errors.sermonNotFound"));
          return;
        }

        setSermon(sermonData);

        // Initialize the combined plan if a plan already exists
        if (sermonData.plan) {
          setCombinedPlan({
            introduction: sermonData.plan.introduction?.outline || "",
            main: sermonData.plan.main?.outline || "",
            conclusion: sermonData.plan.conclusion?.outline || "",
          });

          // Initialize generatedContent from saved outlinePoints if they exist
          const savedContent: Record<string, string> = {};
          const savedPoints: Record<string, boolean> = {};

          // Extract all saved outline point content
          ['introduction', 'main', 'conclusion'].forEach(sectionKey => {
            const section = sermonData.plan?.[sectionKey as keyof Plan];
            const outlinePoints = section?.outlinePoints || {};

            Object.entries(outlinePoints).forEach(([pointId, content]) => {
              savedContent[pointId] = content;
              savedPoints[pointId] = true;
            });
          });

          // Set the saved content to the generatedContent state
          if (Object.keys(savedContent).length > 0) {
            setGeneratedContent(prev => ({ ...prev, ...savedContent }));
          }

          // Set all saved points at once
          if (Object.keys(savedPoints).length > 0) {
            setSavedSermonPoints(savedPoints);
          }
        }
      } catch (err) {
        setError(t("errors.failedToLoadSermon"));
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    if (sermonId) {
      loadSermon();
    }
  }, [sermonId, t]);

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

    // 1. Найти точку плана и определить, к какой секции она относится
    let sectionName: string | null = null;

    if (sermon.outline?.introduction.some(op => op.id === outlinePointId)) {
      sectionName = "introduction";
    } else if (sermon.outline?.main.some(op => op.id === outlinePointId)) {
      sectionName = "main";
    } else if (sermon.outline?.conclusion.some(op => op.id === outlinePointId)) {
      sectionName = "conclusion";
    }

    if (!sectionName) {
      // Если секция не найдена, возвращаем мысли в порядке по умолчанию
      return sermon.thoughts.filter(thought => thought.outlinePointId === outlinePointId);
    }

    // 2. Получаем упорядоченный массив ID мыслей из структуры для данной секции
    const structureIds = sermon.structure?.[sectionName as keyof ThoughtsBySection];
    const structureIdsArray = Array.isArray(structureIds) ? structureIds :
      (typeof structureIds === 'string' ? JSON.parse(structureIds) : []);

    // 3. Отфильтровываем все мысли, связанные с данной точкой плана
    const thoughtsForPoint = sermon.thoughts.filter(thought => thought.outlinePointId === outlinePointId);

    // 4. Если массив структуры пуст, возвращаем мысли без сортировки
    if (!structureIdsArray.length) {
      return thoughtsForPoint;
    }

    // 5. Сортируем мысли в соответствии с порядком в структуре
    return thoughtsForPoint.sort((a, b) => {
      const indexA = structureIdsArray.indexOf(a.id);
      const indexB = structureIdsArray.indexOf(b.id);

      // Если мысль не найдена в структуре, помещаем её в конец
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;

      // Сортировка по порядку в структуре
      return indexA - indexB;
    });
  };

  // Find thoughts for an outline point
  // const findThoughtsForSermonPoint = (outlinePointId: string): Thought[] => {
  //   // Используем существующую функцию с учетом порядка из структуры
  //   return getThoughtsForSermonPoint(outlinePointId);
  // };

  // Generate content for an outline point
  const generateSermonPointContent = async (outlinePointId: string) => {
    if (!sermon) return;

    setGeneratingId(outlinePointId);

    try {
      // Find the outline point in the sermon structure
      let outlinePoint: SermonPoint | undefined;
      let section: string | undefined;

      if (sermon.outline?.introduction.some((op) => op.id === outlinePointId)) {
        outlinePoint = sermon.outline.introduction.find((op) => op.id === outlinePointId);
        section = "introduction";
      } else if (sermon.outline?.main.some((op) => op.id === outlinePointId)) {
        outlinePoint = sermon.outline.main.find((op) => op.id === outlinePointId);
        section = "main";
      } else if (sermon.outline?.conclusion.some((op) => op.id === outlinePointId)) {
        outlinePoint = sermon.outline.conclusion.find((op) => op.id === outlinePointId);
        section = "conclusion";
      }

      if (!outlinePoint || !section) {
        toast.error(t("errors.outlinePointNotFound"));
        return;
      }

      // Call the API
      const queryParams = new URLSearchParams({
        outlinePointId,
        style: planStyle
      });
      const response = await fetch(`/api/sermons/${sermon.id}/plan?${queryParams.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to generate content: ${response.status}`);
      }

      const data = await response.json();

      // Update the generated content
      setGeneratedContent((prev) => ({
        ...prev,
        [outlinePointId]: data.content,
      }));

      // Mark content as modified since it was just generated
      setModifiedContent(prev => ({
        ...prev,
        [outlinePointId]: true
      }));

      // Update the combined plan
      updateCombinedPlan(outlinePointId, outlinePoint.text, data.content, section as 'introduction' | 'main' | 'conclusion');

      // Equalize only this pair after content generation
      if (section) {
        syncPairHeights(section as 'introduction' | 'main' | 'conclusion', outlinePointId);
      }

      toast.success(t("plan.contentGenerated"));
    } catch (err) {
      console.error(err);
      toast.error(t("errors.failedToGenerateContent"));
    } finally {
      setGeneratingId(null);
    }
  };

  // Update the combined plan when a new outline point content is generated
  const updateCombinedPlan = (
    outlinePointId: string,
    outlinePointText: string,
    content: string,
    section: 'introduction' | 'main' | 'conclusion'
  ) => {
    setCombinedPlan((prev) => {
      // Create a heading with the outline point text
      const heading = `## ${outlinePointText}`;

      // Current content of the section
      const currentSectionContent = prev[section];

      // Check if the heading already exists in the content
      const headingIndex = currentSectionContent.indexOf(heading);

      if (headingIndex !== -1) {
        // Find the end of the current content for this heading
        const nextHeadingIndex = currentSectionContent.indexOf("## ", headingIndex + heading.length);

        // If there's a next heading, replace the content between the headings
        if (nextHeadingIndex !== -1) {
          const beforeHeading = currentSectionContent.substring(0, headingIndex + heading.length);
          const afterNextHeading = currentSectionContent.substring(nextHeadingIndex);

          return {
            ...prev,
            [section]: `${beforeHeading}\n\n${content}\n\n${afterNextHeading}`,
          };
        } else {
          // If there's no next heading, replace everything after the current heading
          return {
            ...prev,
            [section]: `${currentSectionContent.substring(0, headingIndex + heading.length)}\n\n${content}`,
          };
        }
      } else {
        // If the heading doesn't exist yet, append it to the section
        return {
          ...prev,
          [section]: currentSectionContent
            ? `${currentSectionContent}\n\n${heading}\n\n${content}`
            : `${heading}\n\n${content}`,
        };
      }
    });
  };

  // Save the plan to the server
  // const savePlan = async () => {
  //   if (!sermon) return;
  //
  //   try {
  //     const planToSave: Plan = {
  //       introduction: { outline: combinedPlan.introduction },
  //       main: { outline: combinedPlan.main },
  //       conclusion: { outline: combinedPlan.conclusion },
  //     };
  //
  //     const response = await fetch(`/api/sermons/${sermon.id}/plan`, {
  //       method: "PUT",
  //       headers: {
  //       "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify(planToSave),
  //     });
  //
  //     if (!response.ok) {
  //       throw new Error(`Failed to save plan: ${response.status}`);
  //     }
  //
  //       toast.success(t("plan.planSaved"));
  //   } catch (err) {
  //     console.error(err);
  //     toast.error(t("errors.failedToSavePlan"));
  //   }
  // };

  // Save individual outline point
  const saveSermonPoint = async (outlinePointId: string, content: string, section: keyof Plan) => {
    if (!sermon) return;

    try {
      // First fetch the latest sermon plan from server to avoid overwriting recent changes
      const latestSermonResponse = await fetch(`/api/sermons/${sermon.id}`);
      if (!latestSermonResponse.ok) {
        throw new Error(`Failed to fetch latest sermon data: ${latestSermonResponse.status}`);
      }

      const latestSermon = await latestSermonResponse.json();

      // Create plan object if it doesn't exist
      const currentPlan = latestSermon.plan || {
        introduction: { outline: "" },
        main: { outline: "" },
        conclusion: { outline: "" }
      };

      // Preserve existing outline points and add/update the new one
      const existingSermonPoints = currentPlan[section]?.outlinePoints || {};

      // Update the outline point in the plan
      const updatedPlan: Plan = {
        ...currentPlan,
        [section]: {
          ...currentPlan[section],
          outlinePoints: {
            ...existingSermonPoints,
            [outlinePointId]: content
          }
        }
      };

      // Send the updated plan to the server
      const response = await fetch(`/api/sermons/${sermon.id}/plan`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatedPlan),
      });

      if (!response.ok) {
        throw new Error(`Failed to save outline point: ${response.status}`);
      }

      // Mark this point as saved
      setSavedSermonPoints(prev => ({ ...prev, [outlinePointId]: true }));

      // Mark content as unmodified since it's now saved
      setModifiedContent(prev => ({ ...prev, [outlinePointId]: false }));

      toast.success(t("plan.pointSaved"));

      // Check if all points in this section are saved
      const allPointsInSection = sermon.outline?.[section] || [];
      const allSaved = allPointsInSection.every(point =>
        savedSermonPoints[point.id] || point.id === outlinePointId
      );

      // If all points are saved, update the combined section text
      if (allSaved && allPointsInSection.length > 0) {
        // Collect all content for this section
        const sectionTexts = allPointsInSection.map(point => {
          const pointContent = point.id === outlinePointId ?
            content :
            updatedPlan[section]?.outlinePoints?.[point.id] || "";

          return `## ${point.text}\n\n${pointContent}`;
        });

        const combinedText = sectionTexts.join("\n\n");

        // Update the section outline with the combined text
        const finalPlan: Plan = {
          ...updatedPlan,
          [section]: {
            ...updatedPlan[section],
            outline: combinedText
          }
        };

        // Save the final combined plan
        const finalResponse = await fetch(`/api/sermons/${sermon.id}/plan`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(finalPlan),
        });

        if (finalResponse.ok) {
          // Update the local sermon data with the latest plan
          setSermon(prevSermon => prevSermon ? { ...prevSermon, plan: finalPlan } : null);

          // Update the local combined plan state
          setCombinedPlan(prev => ({
            ...prev,
            [section]: combinedText
          }));

          toast.success(t("plan.sectionSaved", { section: t(`sections.${section}`) }));
        } else {
          throw new Error(`Failed to save section: ${finalResponse.status}`);
        }
      } else {
        // Update local sermon data with the latest plan even if we don't save the combined text
        setSermon(prevSermon => prevSermon ? { ...prevSermon, plan: updatedPlan } : null);
      }
    } catch (err) {
      console.error(err);
      toast.error(t("errors.failedToSavePoint"));
    }
  };

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
  const findSermonPointById = (outlinePointId: string): SermonPoint | undefined => {
    if (!sermon || !sermon.outline) return undefined;

    let outlinePoint;

    if (sermon.outline.introduction.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.introduction.find(op => op.id === outlinePointId);
    } else if (sermon.outline.main.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.main.find(op => op.id === outlinePointId);
    } else if (sermon.outline.conclusion.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.conclusion.find(op => op.id === outlinePointId);
    }

    return outlinePoint;
  };

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
      console.error(error);
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
      console.error(error);
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
      console.error(error);
    }

    return false;
  }, []);

  const handleClosePlanView = useCallback(() => {
    updatePlanViewMode(null);
  }, [updatePlanViewMode]);

  const handleOpenPlanOverlay = useCallback(() => {
    updatePlanViewMode("overlay");
  }, [updatePlanViewMode]);

  const handleOpenPlanImmersive = useCallback(() => {
    updatePlanViewMode("immersive");
  }, [updatePlanViewMode]);


  const handleSetTimer = useCallback((hours: number, minutes: number, seconds: number) => {
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    setPreachingDuration(totalSeconds);
    // Don't switch to preaching mode yet, just set the timer
  }, []);

  const handleSetTimerDuration = useCallback((durationSeconds: number) => {
    setPreachingDuration(durationSeconds);
  }, []);

  const handleSwitchToDurationSelector = useCallback(() => {
    // No longer needed - kept for compatibility
    // Timer now handles duration selection internally
  }, []);

  const handleStartPreachingMode = useCallback(() => {
    // Start preaching mode - timer starts at 0:00 (idle state)
    setPreachingDuration(null); // Start with no duration (timer will be idle)
    updatePlanViewMode("preaching");
  }, [updatePlanViewMode]);

  // Alias for compatibility with ViewPlanMenu component
  const handleOpenTimePicker = handleStartPreachingMode;

  // Generate content for export as text
  const getExportContent = async (format: 'plain' | 'markdown'): Promise<string> => {
    if (!sermon) return '';

    const titleSection = `# ${sermon.title}\n\n`;
    const verseSection = sermon.verse ? `> ${sermon.verse}\n\n` : '';

    // Format the outline points and their content
    const introSection = `## ${t("sections.introduction")}\n\n${combinedPlan.introduction || t("plan.noContent")}\n\n`;
    const mainSection = `## ${t("sections.main")}\n\n${combinedPlan.main || t("plan.noContent")}\n\n`;
    const conclusionSection = `## ${t("sections.conclusion")}\n\n${combinedPlan.conclusion || t("plan.noContent")}\n\n`;

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
              {t("common.scripture")}
            </p>
          </div>
        )}

        <div className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]}`}>
          <h2 className={`text-2xl font-bold ${SERMON_SECTION_COLORS.introduction.text} mb-4`}>
            {t("sections.introduction")}
          </h2>
          <div className={`pl-2 border-l-4 ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]}`}>
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {combinedPlan.introduction || t("plan.noContent")}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        <div className={`mb-8 pb-6 border-b-2 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]}`}>
          <h2 className={`text-2xl font-bold ${SERMON_SECTION_COLORS.mainPart.text} mb-4`}>
            {t("sections.main")}
          </h2>
          <div className={`pl-2 border-l-4 ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]}`}>
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {combinedPlan.main || t("plan.noContent")}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <h2 className={`text-2xl font-bold ${SERMON_SECTION_COLORS.conclusion.text} mb-4`}>
            {t("sections.conclusion")}
          </h2>
          <div className={`pl-2 border-l-4 ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]}`}>
            <div className="prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {combinedPlan.conclusion || t("plan.noContent")}
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
      <>
        <style jsx global>{sectionButtonStyles}</style>
        <style jsx global>{`
          /* Markdown content styling */
          .markdown-content {
            line-height: 1.5;
          }
          .markdown-content p {
            margin-top: 0.5em;
            margin-bottom: 0.5em;
          }
          .markdown-content h1,
          .markdown-content h2,
          .markdown-content h3,
          .markdown-content h4,
          .markdown-content h5,
          .markdown-content h6 {
            margin-top: 1em;
            margin-bottom: 0.5em;
          }

          /* Visual markers for different heading levels */
          .markdown-content h2::before {
            content: "";
            display: inline-block;
            width: 6px;
            height: 20px;
            background-color: ${SERMON_SECTION_COLORS.introduction.base};
            margin-right: 10px;
            border-radius: 2px;
            vertical-align: text-top;
          }

          /* Use section context to style bullets */
          /* Introduction bullets (h3) */
          .markdown-content.prose-introduction h3::before,
          .markdown-content.introduction-section h3::before {
            content: "•";
            display: inline-block;
            margin-right: 8px;
            color: ${SERMON_SECTION_COLORS.introduction.light};
            font-weight: bold;
          }

          /* Main section bullets (h3) */
          .markdown-content.prose-main h3::before,
          .markdown-content.main-section h3::before {
            content: "•";
            display: inline-block;
            margin-right: 8px;
            color: ${SERMON_SECTION_COLORS.mainPart.light};
            font-weight: bold;
          }

          /* Conclusion bullets (h3) */
          .markdown-content.prose-conclusion h3::before,
          .markdown-content.conclusion-section h3::before {
            content: "•";
            display: inline-block;
            margin-right: 8px;
            color: ${SERMON_SECTION_COLORS.conclusion.light};
            font-weight: bold;
          }

          /* Default h3 bullets - only apply when no section class is present */
          .markdown-content h3:not(.markdown-content.prose-introduction h3):not(.markdown-content.prose-main h3):not(.markdown-content.prose-conclusion h3):not(.markdown-content.introduction-section h3):not(.markdown-content.main-section h3):not(.markdown-content.conclusion-section h3)::before {
            content: "•";
            display: inline-block;
            margin-right: 8px;
            color: ${SERMON_SECTION_COLORS.mainPart.base};
            font-weight: bold;
          }

          /* Default h4 circles */
          .markdown-content h4::before {
            content: "○";
            display: inline-block;
            margin-right: 8px;
            color: ${SERMON_SECTION_COLORS.conclusion.base};
            font-weight: bold;
          }

          /* Section-specific styles for introduction section */
          .markdown-content.prose-introduction h2::before {
            background-color: ${SERMON_SECTION_COLORS.introduction.base};
          }
          .markdown-content.prose-introduction h4::before {
            color: ${SERMON_SECTION_COLORS.introduction.dark};
          }

          /* Section-specific styles for main section */
          .markdown-content.prose-main h2::before {
            background-color: ${SERMON_SECTION_COLORS.mainPart.base};
          }
          .markdown-content.prose-main h4::before {
            color: ${SERMON_SECTION_COLORS.mainPart.dark};
          }

          /* Section-specific styles for conclusion section */
          .markdown-content.prose-conclusion h2::before {
            background-color: ${SERMON_SECTION_COLORS.conclusion.base};
          }
          .markdown-content.prose-conclusion h4::before {
            color: ${SERMON_SECTION_COLORS.conclusion.dark};
          }

          /* Dark mode colors */
          @media (prefers-color-scheme: dark) {
            .markdown-content h2::before {
              background-color: ${SERMON_SECTION_COLORS.introduction.light};
            }
            .markdown-content h3:not(.markdown-content.prose-introduction h3):not(.markdown-content.prose-main h3):not(.markdown-content.prose-conclusion h3):not(.markdown-content.introduction-section h3):not(.markdown-content.main-section h3):not(.markdown-content.conclusion-section h3)::before {
              color: ${SERMON_SECTION_COLORS.mainPart.light};
            }
            .markdown-content h4::before {
              color: ${SERMON_SECTION_COLORS.conclusion.light};
            }
          }

          /* Preaching mode specific styles */
          .preaching-mode {
            padding-top: 80px; /* Desktop: Account for sticky timer header */
          }

          @media (max-width: 768px) {
            .preaching-mode {
              padding-top: 65px; /* Tablet: Slightly less padding */
            }
          }

          @media (max-width: 640px) {
            .preaching-mode {
              padding-top: 50px; /* Mobile: Less padding for compact timer */
            }
          }

          .preaching-content {
            max-width: 4xl;
            margin: 0 auto;
          }
        `}</style>
        <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900" data-testid="sermon-plan-immersive-view">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-4">
            <div>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{sermon.title}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("plan.pageTitle")}</p>
            </div>
            <div className="flex items-center gap-2 h-10">
              <Button
                onClick={async () => {
                  if (immersiveCopyStatus === 'copying') {
                    return;
                  }
                  setImmersiveCopyStatus('copying');
                  const copied = await copyFormattedFromElement(immersiveContentRef.current);
                  if (copied) {
                    toast.success(t("plan.copySuccess"));
                    setImmersiveCopyStatus('success');
                    if (immersiveCopyTimeoutRef.current) {
                      clearTimeout(immersiveCopyTimeoutRef.current);
                    }
                    immersiveCopyTimeoutRef.current = setTimeout(() => {
                      setImmersiveCopyStatus('idle');
                      immersiveCopyTimeoutRef.current = null;
                    }, 2000);
                  } else {
                    toast.error(t("plan.copyError"));
                    setImmersiveCopyStatus('error');
                    if (immersiveCopyTimeoutRef.current) {
                      clearTimeout(immersiveCopyTimeoutRef.current);
                    }
                    immersiveCopyTimeoutRef.current = setTimeout(() => {
                      setImmersiveCopyStatus('idle');
                      immersiveCopyTimeoutRef.current = null;
                    }, 2500);
                  }
                }}
                variant="secondary"
                className={`${copyButtonClasses} ${copyButtonStatusClasses[immersiveCopyStatus]}`}
                title={
                  immersiveCopyStatus === 'success'
                    ? t("common.copied")
                    : immersiveCopyStatus === 'error'
                      ? t("plan.copyError")
                      : immersiveCopyStatus === 'copying'
                        ? t('copy.copying', { defaultValue: 'Copying…' })
                        : t("copy.copyFormatted")
                }
                disabled={immersiveCopyStatus === 'copying'}
              >
                {immersiveCopyStatus === 'copying' ? (
                  <LoadingSpinner size="small" />
                ) : immersiveCopyStatus === 'success' ? (
                  <Check className="h-6 w-6 text-green-200" />
                ) : immersiveCopyStatus === 'error' ? (
                  <X className="h-6 w-6 text-rose-200" />
                ) : (
                  <Copy className="h-6 w-6" />
                )}
              </Button>
              <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {immersiveCopyStatus === 'success'
                  ? t("plan.copySuccess")
                  : immersiveCopyStatus === 'error'
                    ? t("plan.copyError")
                    : immersiveCopyStatus === 'copying'
                      ? t('copy.copying', { defaultValue: 'Copying…' })
                      : ''}
              </span>
              <button
                onClick={handleOpenPlanOverlay}
                className="flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700"
                title={t("plan.exitFullscreen")}
              >
                <Minimize2 className="h-7 w-7" />
              </button>
              <button
                onClick={handleClosePlanView}
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
                timerState={preachingTimerState}
                isPreachingMode={isPlanPreaching}
              />
            </div>
          </main>
        </div>
      </>
    );
  }


  // Preaching view with timer
  if (isPlanPreaching && sermon) {
    return (
      <>
        <style jsx global>{sectionButtonStyles}</style>
        <style jsx global>{`
          /* Markdown content styling */
          .markdown-content {
            line-height: 1.5;
          }
          .markdown-content p {
            margin-top: 0.5em;
            margin-bottom: 0.5em;
          }
          .markdown-content h1,
          .markdown-content h2,
          .markdown-content h3,
          .markdown-content h4,
          .markdown-content h5,
          .markdown-content h6 {
            margin-top: 1em;
            margin-bottom: 0.5em;
          }

          /* Visual markers for different heading levels */
          .markdown-content h2::before {
            content: "";
            display: inline-block;
            width: 6px;
            height: 20px;
            background-color: ${SERMON_SECTION_COLORS.introduction.base};
            margin-right: 10px;
            border-radius: 2px;
            vertical-align: text-top;
          }

          /* Use section context to style bullets */
          /* Introduction bullets (h3) */
          .markdown-content.prose-introduction h3::before,
          .markdown-content.introduction-section h3::before {
            content: "•";
            display: inline-block;
            margin-right: 8px;
            color: ${SERMON_SECTION_COLORS.introduction.light};
            font-weight: bold;
          }

          /* Main section bullets (h3) */
          .markdown-content.prose-main h3::before,
          .markdown-content.main-section h3::before {
            content: "•";
            display: inline-block;
            margin-right: 8px;
            color: ${SERMON_SECTION_COLORS.mainPart.light};
            font-weight: bold;
          }

          /* Conclusion bullets (h3) */
          .markdown-content.prose-conclusion h3::before,
          .markdown-content.conclusion-section h3::before {
            content: "•";
            display: inline-block;
            margin-right: 8px;
            color: ${SERMON_SECTION_COLORS.conclusion.light};
            font-weight: bold;
          }

          /* Default h3 bullets - only apply when no section class is present */
          .markdown-content h3:not(.markdown-content.prose-introduction h3):not(.markdown-content.prose-main h3):not(.markdown-content.prose-conclusion h3):not(.markdown-content.introduction-section h3):not(.markdown-content.main-section h3):not(.markdown-content.conclusion-section h3)::before {
            content: "•";
            display: inline-block;
            margin-right: 8px;
            color: ${SERMON_SECTION_COLORS.mainPart.base};
            font-weight: bold;
          }

          /* Default h4 circles */
          .markdown-content h4::before {
            content: "○";
            display: inline-block;
            margin-right: 8px;
            color: ${SERMON_SECTION_COLORS.conclusion.base};
            font-weight: bold;
          }

          /* Section-specific styles for introduction section */
          .markdown-content.prose-introduction h2::before {
            background-color: ${SERMON_SECTION_COLORS.introduction.base};
          }
          .markdown-content.prose-introduction h4::before {
            color: ${SERMON_SECTION_COLORS.introduction.dark};
          }

          /* Section-specific styles for main section */
          .markdown-content.prose-main h2::before {
            background-color: ${SERMON_SECTION_COLORS.mainPart.base};
          }
          .markdown-content.prose-main h4::before {
            color: ${SERMON_SECTION_COLORS.mainPart.dark};
          }

          /* Section-specific styles for conclusion section */
          .markdown-content.prose-conclusion h2::before {
            background-color: ${SERMON_SECTION_COLORS.conclusion.base};
          }
          .markdown-content.prose-conclusion h4::before {
            color: ${SERMON_SECTION_COLORS.conclusion.dark};
          }

          /* Dark mode colors */
          @media (prefers-color-scheme: dark) {
            .markdown-content h2::before {
              background-color: ${SERMON_SECTION_COLORS.introduction.light};
            }
            .markdown-content h3:not(.markdown-content.prose-introduction h3):not(.markdown-content.prose-main h3):not(.markdown-content.prose-conclusion h3):not(.markdown-content.introduction-section h3):not(.markdown-content.main-section h3):not(.markdown-content.conclusion-section h3)::before {
              color: ${SERMON_SECTION_COLORS.mainPart.light};
            }
            .markdown-content h4::before {
              color: ${SERMON_SECTION_COLORS.conclusion.light};
            }
          }

          /* Preaching mode specific styles */
          .preaching-mode {
            padding-top: 80px; /* Desktop: Account for sticky timer header */
          }

          @media (max-width: 768px) {
            .preaching-mode {
              padding-top: 65px; /* Tablet: Slightly less padding */
            }
          }

          @media (max-width: 640px) {
            .preaching-mode {
              padding-top: 50px; /* Mobile: Less padding for compact timer */
            }
          }

          .preaching-content {
            max-width: 4xl;
            margin: 0 auto;
          }
        `}</style>
        <div className={`min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900 ${preachingDuration && preachingDuration > 0 ? 'preaching-mode' : ''}`}>
          {/* Sticky Timer Header - Always show in preaching mode */}
          <div className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">
            <PreachingTimer
              initialDuration={preachingDuration !== null ? preachingDuration : 0}
              className="border-0 shadow-none"
              sermonId={sermonId}
              onExitPreaching={() => updatePlanViewMode(null)}
              onTimerStateChange={handleTimerStateChange}
              onTimerFinished={() => {
                console.log('Timer finished naturally, showing negative countdown');
                // Don't reset preachingDuration - let timer show negative values
                // User can manually exit via "Exit Preaching Mode" button
              }}
              onSetDuration={handleSetTimerDuration}
              onSwitchToDurationSelector={handleSwitchToDurationSelector}
            />
          </div>

          {/* Floating Text Scale Controls */}
          <FloatingTextScaleControls />

          {/* Show plan content in preaching mode */}
          {planViewMode === "preaching" && (
            <main className="flex-1 overflow-y-auto">
              <div className="preaching-content px-6 py-8">
                <FullPlanContent
                  sermonTitle={sermon.title}
                  sermonVerse={sermon.verse}
                  combinedPlan={combinedPlan}
                  t={t}
                  timerState={preachingTimerState}
                  isPreachingMode={isPlanPreaching}
                />

              </div>
            </main>
          )}
        </div>
      </>
    );
  }

  const planOverlayPortal = isPlanOverlay && typeof document !== 'undefined' && sermon
    ? createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm" data-testid="sermon-plan-overlay">
        <div className="flex flex-1 justify-center p-4 overflow-y-auto">
          <div className="flex w-full flex-1 max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900 max-h-[calc(100vh-2rem)] min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-900">
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">{sermon.title}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("plan.pageTitle")}</p>
              </div>
              <div className="flex items-center gap-2 h-10">
                <Button
                  onClick={async () => {
                    if (overlayCopyStatus === 'copying') {
                      return;
                    }
                    setOverlayCopyStatus('copying');
                    const copied = await copyFormattedFromElement(planOverlayContentRef.current);
                    if (copied) {
                      toast.success(t("plan.copySuccess"));
                      setOverlayCopyStatus('success');
                      if (overlayCopyTimeoutRef.current) {
                        clearTimeout(overlayCopyTimeoutRef.current);
                      }
                      overlayCopyTimeoutRef.current = setTimeout(() => {
                        setOverlayCopyStatus('idle');
                        overlayCopyTimeoutRef.current = null;
                      }, 2000);
                    } else {
                      toast.error(t("plan.copyError"));
                      setOverlayCopyStatus('error');
                      if (overlayCopyTimeoutRef.current) {
                        clearTimeout(overlayCopyTimeoutRef.current);
                      }
                      overlayCopyTimeoutRef.current = setTimeout(() => {
                        setOverlayCopyStatus('idle');
                        overlayCopyTimeoutRef.current = null;
                      }, 2500);
                    }
                  }}
                  variant="secondary"
                  className={`${copyButtonClasses} ${copyButtonStatusClasses[overlayCopyStatus]}`}
                  title={
                    overlayCopyStatus === 'success'
                      ? t("common.copied")
                      : overlayCopyStatus === 'error'
                        ? t("plan.copyError")
                        : overlayCopyStatus === 'copying'
                          ? t('copy.copying', { defaultValue: 'Copying…' })
                          : t("copy.copyFormatted")
                  }
                  disabled={overlayCopyStatus === 'copying'}
                >
                  {overlayCopyStatus === 'copying' ? (
                    <LoadingSpinner size="small" />
                  ) : overlayCopyStatus === 'success' ? (
                    <Check className="h-6 w-6 text-green-200" />
                  ) : overlayCopyStatus === 'error' ? (
                    <X className="h-6 w-6 text-rose-200" />
                  ) : (
                    <Copy className="h-6 w-6" />
                  )}
                </Button>
                <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                  {overlayCopyStatus === 'success'
                    ? t("plan.copySuccess")
                    : overlayCopyStatus === 'error'
                      ? t("plan.copyError")
                      : overlayCopyStatus === 'copying'
                        ? t('copy.copying', { defaultValue: 'Copying…' })
                        : ''}
                </span>
                <button
                  onClick={handleOpenPlanImmersive}
                  className="flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700"
                  title={t("plan.fullscreen")}
                >
                  <Maximize2 className="h-7 w-7" />
                </button>
                <button
                  onClick={handleClosePlanView}
                  className="flex items-center justify-center w-12 h-12 p-0 rounded-md transition-all duration-200 bg-gray-600 text-white hover:bg-gray-700"
                  title={t("actions.close")}
                >
                  <X className="h-7 w-7" />
                </button>
              </div>
            </div>
            <div ref={planOverlayContentRef} className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
              <FullPlanContent
                sermonTitle={sermon.title}
                sermonVerse={sermon.verse}
                combinedPlan={combinedPlan}
                t={t}
                timerState={preachingTimerState}
                isPreachingMode={isPlanPreaching}
              />
            </div>
          </div>
        </div>
      </div>,
      document.body
    )
    : null;

  return (
    <>
      {planOverlayPortal}
      <div
        className="p-4"
        data-testid="sermon-plan-page-container"
      >
        <style jsx global>{sectionButtonStyles}</style>
        <style jsx global>{`
        /* Prevent scroll anchoring in dynamic plan columns */
        [data-testid="plan-introduction-left-section"],
        [data-testid="plan-introduction-right-section"],
        [data-testid="plan-main-left-section"],
        [data-testid="plan-main-right-section"],
        [data-testid="plan-conclusion-left-section"],
        [data-testid="plan-conclusion-right-section"] {
          overflow-anchor: none;
        }

        /* Markdown content styling */
        .markdown-content {
          line-height: 1.5;
        }
        .markdown-content p {
          margin-top: 0.5em;
          margin-bottom: 0.5em;
        }
        .markdown-content h1,
        .markdown-content h2,
        .markdown-content h3,
        .markdown-content h4,
        .markdown-content h5,
        .markdown-content h6 {
          margin-top: 1em;
          margin-bottom: 0.5em;
        }
        /* Indentation for hierarchical structure */
        .markdown-content h2 {
          margin-left: 0;
        }
        .markdown-content h3 {
          margin-left: 1.5rem;
        }
        .markdown-content h4, .markdown-content h5, .markdown-content h6 {
          margin-left: 3rem;
        }
        /* Indent paragraphs and lists to align with their headings */
        .markdown-content h2 + p, .markdown-content h2 + ul, .markdown-content h2 + ol {
          margin-left: 1.5rem;
        }
        .markdown-content h3 + p, .markdown-content h3 + ul, .markdown-content h3 + ol {
          margin-left: 3rem;
        }
        .markdown-content h4 + p, .markdown-content h4 + ul, .markdown-content h4 + ol,
        .markdown-content h5 + p, .markdown-content h5 + ul, .markdown-content h5 + ol,
        .markdown-content h6 + p, .markdown-content h6 + ul, .markdown-content h6 + ol {
          margin-left: 4.5rem;
        }
        /* Continuing indentation for paragraphs without headings */
        .markdown-content p + p, .markdown-content ul + p, .markdown-content ol + p {
          margin-left: inherit;
        }
        .markdown-content ul,
        .markdown-content ol {
          margin-top: 0.5em;
          margin-bottom: 0.5em;
          padding-left: 1.5em;
        }
        .markdown-content li {
          margin-top: 0.25em;
          margin-bottom: 0.25em;
        }
        .markdown-content li > p {
          margin-top: 0;
          margin-bottom: 0;
        }
        /* Remove borders from all elements */
        .markdown-content * {
          border: none !important;
        }
        /* Fix for first paragraph layout issue */
        .markdown-content > p:first-child {
          margin-top: 0;
          display: inline-block;
        }
        /* Ensure first element doesn't create unwanted space */
        .markdown-content > *:first-child {
          margin-top: 0;
        }

        /* Visual markers for different heading levels */
        .markdown-content h2::before {
          content: "";
          display: inline-block;
          width: 6px;
          height: 20px;
          background-color: ${SERMON_SECTION_COLORS.introduction.base};
          margin-right: 10px;
          border-radius: 2px;
          vertical-align: text-top;
        }

        /* Use section context to style bullets */
        /* Introduction bullets (h3) */
        .markdown-content.prose-introduction h3::before,
        .markdown-content.introduction-section h3::before {
          content: "•";
          display: inline-block;
          margin-right: 8px;
          color: ${SERMON_SECTION_COLORS.introduction.light};
          font-weight: bold;
        }

        /* Main section bullets (h3) */
        .markdown-content.prose-main h3::before,
        .markdown-content.main-section h3::before {
          content: "•";
          display: inline-block;
          margin-right: 8px;
          color: ${SERMON_SECTION_COLORS.mainPart.light};
          font-weight: bold;
        }

        /* Conclusion bullets (h3) */
        .markdown-content.prose-conclusion h3::before,
        .markdown-content.conclusion-section h3::before {
          content: "•";
          display: inline-block;
          margin-right: 8px;
          color: ${SERMON_SECTION_COLORS.conclusion.light};
          font-weight: bold;
        }

        /* Default h3 bullets - only apply when no section class is present */
        .markdown-content h3:not(.markdown-content.prose-introduction h3):not(.markdown-content.prose-main h3):not(.markdown-content.prose-conclusion h3):not(.markdown-content.introduction-section h3):not(.markdown-content.main-section h3):not(.markdown-content.conclusion-section h3)::before {
          content: "•";
          display: inline-block;
          margin-right: 8px;
          color: ${SERMON_SECTION_COLORS.mainPart.base};
          font-weight: bold;
        }

        /* Default h4 circles */
        .markdown-content h4::before {
          content: "○";
          display: inline-block;
          margin-right: 8px;
          color: ${SERMON_SECTION_COLORS.conclusion.base};
          font-weight: bold;
        }

        /* Section-specific styles for introduction section */
        .markdown-content.prose-introduction h2::before {
          background-color: ${SERMON_SECTION_COLORS.introduction.base};
        }
        .markdown-content.prose-introduction h4::before {
          color: ${SERMON_SECTION_COLORS.introduction.dark};
        }

        /* Section-specific styles for main section */
        .markdown-content.prose-main h2::before {
          background-color: ${SERMON_SECTION_COLORS.mainPart.base};
        }
        .markdown-content.prose-main h4::before {
          color: ${SERMON_SECTION_COLORS.mainPart.dark};
        }

        /* Section-specific styles for conclusion section */
        .markdown-content.prose-conclusion h2::before {
          background-color: ${SERMON_SECTION_COLORS.conclusion.base};
        }
        .markdown-content.prose-conclusion h4::before {
          color: ${SERMON_SECTION_COLORS.conclusion.dark};
        }

        /* Dark mode colors */
        @media (prefers-color-scheme: dark) {
          .markdown-content h2::before {
            background-color: ${SERMON_SECTION_COLORS.introduction.light};
          }
          .markdown-content h3:not(.markdown-content.prose-introduction h3):not(.markdown-content.prose-main h3):not(.markdown-content.prose-conclusion h3):not(.markdown-content.introduction-section h3):not(.markdown-content.main-section h3):not(.markdown-content.conclusion-section h3)::before {
            color: ${SERMON_SECTION_COLORS.mainPart.light};
          }
          .markdown-content h4::before {
            color: ${SERMON_SECTION_COLORS.conclusion.light};
          }
        }
      `}</style>
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
                {/* <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {t("plan.pageTitle")}
              </h1> */}
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
                      {t("common.scripture")}
                    </p>
                  </div>
                )}

                {/* View Plan Buttons */}
                <div className="flex flex-wrap gap-3 mt-6">
                  <ViewPlanMenu
                    sermonTitle={sermon.title}
                    sermonId={sermonId}
                    combinedPlan={combinedPlan}
                    sectionMenuRef={sectionMenuRef}
                    showSectionMenu={showSectionMenu}
                    setShowSectionMenu={setShowSectionMenu}
                    onRequestPlanOverlay={handleOpenPlanOverlay}
                    onRequestPreachingMode={handleOpenTimePicker}
                    onStartPreachingMode={handleStartPreachingMode}
                  />

                  {/* Add Export Buttons */}
                  <ExportButtons
                    sermonId={sermonId}
                    getExportContent={getExportContent}
                    getPdfContent={getPdfContent}
                    title={sermon.title || "Sermon Plan"}
                    className="ml-auto"
                    disabledFormats={['pdf']} // Add this prop to disable PDF
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Introduction header */}
            <div ref={introductionSectionRef} data-section="introduction" className="lg:col-span-2">
              <PlanStyleSelector
                value={planStyle}
                onChange={setPlanStyle}
                disabled={isLoading || !!generatingId}
              />

              <SectionHeader
                section="introduction"
                onSwitchPage={handleSwitchToStructure}
              /></div>
            {/* Intro Left & Right */}
            <div
              data-testid="plan-introduction-left-section"
              className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} ${SERMON_SECTION_COLORS.introduction.bg} dark:${SERMON_SECTION_COLORS.introduction.darkBg}`}
            >
              <div className="p-3">
                {sermon.outline?.introduction.map((outlinePoint) => (
                  <SermonPointCard
                    key={outlinePoint.id}
                    ref={(el) => {
                      if (!introPointRefs.current[outlinePoint.id]) {
                        introPointRefs.current[outlinePoint.id] = { left: null, right: null };
                      }
                      introPointRefs.current[outlinePoint.id].left = el;
                    }}
                    outlinePoint={outlinePoint}
                    thoughts={getThoughtsForSermonPoint(outlinePoint.id)}
                    sectionName="introduction"
                    onGenerate={generateSermonPointContent}
                    generatedContent={generatedContent[outlinePoint.id] || null}
                    isGenerating={generatingId === outlinePoint.id}
                    sermonId={sermonId}
                    onOpenFragmentsModal={setModalSermonPointId}
                  />
                ))}
                {sermon.outline?.introduction.length === 0 && (
                  <p className="text-gray-500">{t("plan.noSermonPoints")}</p>
                )}
              </div>
            </div>

            <div
              data-testid="plan-introduction-right-section"
              className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.introduction.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.introduction.darkBorder} ${SERMON_SECTION_COLORS.introduction.bg} dark:${SERMON_SECTION_COLORS.introduction.darkBg}`}
            >
              <div className="p-3">
                {sermon.outline?.introduction.map((outlinePoint) => (
                  <div
                    key={outlinePoint.id}
                    ref={(el) => {
                      if (!introPointRefs.current[outlinePoint.id]) {
                        introPointRefs.current[outlinePoint.id] = { left: null, right: null };
                      }
                      introPointRefs.current[outlinePoint.id].right = el;
                    }}
                    className="mb-4 bg-white dark:bg-gray-800 border rounded-lg p-4 shadow-sm"
                  >
                    <h3 className={`font-semibold text-lg mb-2 ${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText} flex justify-between items-center`}>
                      {outlinePoint.text}
                      <div className="flex space-x-2">
                        <Button
                          className="text-sm px-2 py-1 h-8"
                          onClick={() => saveSermonPoint(
                            outlinePoint.id,
                            generatedContent[outlinePoint.id] || "",
                            "introduction"
                          )}
                          variant={modifiedContent[outlinePoint.id] ? "section" : "default"}
                          sectionColor={modifiedContent[outlinePoint.id] ? SERMON_SECTION_COLORS.introduction : undefined}
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
                        onClick={() => toggleEditMode(outlinePoint.id)}
                        variant="default"
                        title={editModePoints[outlinePoint.id] ? t("plan.viewMode") : t("plan.editMode")}
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
                          placeholder={t("plan.noContent")}
                          value={generatedContent[outlinePoint.id] || ""}
                          onChange={(e) => {
                            const newContent = e.target.value;
                            // Mark content as modified if it's different from the current saved content
                            const currentSavedContent = sermon.plan?.introduction?.outlinePoints?.[outlinePoint.id] || "";
                            const isModified = newContent !== currentSavedContent;

                            setGeneratedContent((prev) => ({
                              ...prev,
                              [outlinePoint.id]: newContent,
                            }));

                            // Mark as modified if content changed
                            setModifiedContent(prev => ({
                              ...prev,
                              [outlinePoint.id]: isModified
                            }));

                            updateCombinedPlan(
                              outlinePoint.id,
                              outlinePoint.text,
                              newContent,
                              "introduction"
                            );
                            // Height will be synced by the MutationObserver
                          }}
                          onHeightChange={() => {
                            // Equalize only the affected pair to reduce scroll jumps
                            syncPairHeights('introduction', outlinePoint.id);
                          }}
                        />
                      ) : (
                        <div className="relative border rounded-md dark:bg-gray-700 dark:border-gray-600 text-base min-h-[100px]">
                          <div className="absolute top-2 right-2 z-10">
                            <Button
                              className="text-sm px-2 py-1 h-8"
                              onClick={() => toggleEditMode(outlinePoint.id)}
                              variant="default"
                              title={t("plan.editMode")}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="p-3 pr-12">
                            <MarkdownRenderer
                              markdown={generatedContent[outlinePoint.id] || t("plan.noContent")}
                              section="introduction"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sermon.outline?.introduction.length === 0 && (
                  <p className="text-gray-500">{t("plan.noSermonPoints")}</p>
                )}
              </div>
            </div>

            {/* Main header */}
            <div ref={mainSectionRef} data-section="main" className="lg:col-span-2">
              <SectionHeader section="main" onSwitchPage={handleSwitchToStructure} />
            </div>
            {/* Main Left & Right */}
            <div
              data-testid="plan-main-left-section"
              className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} ${SERMON_SECTION_COLORS.mainPart.bg} dark:${SERMON_SECTION_COLORS.mainPart.darkBg}`}
            >
              <div className="p-3">
                {sermon.outline?.main.map((outlinePoint) => (
                  <SermonPointCard
                    key={outlinePoint.id}
                    ref={(el) => {
                      if (!mainPointRefs.current[outlinePoint.id]) {
                        mainPointRefs.current[outlinePoint.id] = { left: null, right: null };
                      }
                      mainPointRefs.current[outlinePoint.id].left = el;
                    }}
                    outlinePoint={outlinePoint}
                    thoughts={getThoughtsForSermonPoint(outlinePoint.id)}
                    sectionName="main"
                    onGenerate={generateSermonPointContent}
                    generatedContent={generatedContent[outlinePoint.id] || null}
                    isGenerating={generatingId === outlinePoint.id}
                    sermonId={sermonId}
                    onOpenFragmentsModal={setModalSermonPointId}
                  />
                ))}
                {sermon.outline?.main.length === 0 && (
                  <p className="text-gray-500">{t("plan.noSermonPoints")}</p>
                )}
              </div>
            </div>

            <div
              data-testid="plan-main-right-section"
              className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.mainPart.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder} ${SERMON_SECTION_COLORS.mainPart.bg} dark:${SERMON_SECTION_COLORS.mainPart.darkBg}`}
            >
              <div className="p-3">
                {sermon.outline?.main.map((outlinePoint) => (
                  <div
                    key={outlinePoint.id}
                    ref={(el) => {
                      if (!mainPointRefs.current[outlinePoint.id]) {
                        mainPointRefs.current[outlinePoint.id] = { left: null, right: null };
                      }
                      mainPointRefs.current[outlinePoint.id].right = el;
                    }}
                    className="mb-4 bg-white dark:bg-gray-800 border rounded-lg p-4 shadow-sm"
                  >
                    <h3 className={`font-semibold text-lg mb-2 ${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText} flex justify-between items-center`}>
                      {outlinePoint.text}
                      <div className="flex space-x-2">
                        <Button
                          className="text-sm px-2 py-1 h-8"
                          onClick={() => saveSermonPoint(
                            outlinePoint.id,
                            generatedContent[outlinePoint.id] || "",
                            "main"
                          )}
                          variant={modifiedContent[outlinePoint.id] ? "section" : "default"}
                          sectionColor={modifiedContent[outlinePoint.id] ? SERMON_SECTION_COLORS.mainPart : undefined}
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
                        onClick={() => toggleEditMode(outlinePoint.id)}
                        variant="default"
                        title={editModePoints[outlinePoint.id] ? t("plan.viewMode") : t("plan.editMode")}
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
                          placeholder={t("plan.noContent")}
                          value={generatedContent[outlinePoint.id] || ""}
                          onChange={(e) => {
                            const newContent = e.target.value;
                            // Mark content as modified if it's different from the current saved content
                            const currentSavedContent = sermon.plan?.main?.outlinePoints?.[outlinePoint.id] || "";
                            const isModified = newContent !== currentSavedContent;

                            setGeneratedContent((prev) => ({
                              ...prev,
                              [outlinePoint.id]: newContent,
                            }));

                            // Mark as modified if content changed
                            setModifiedContent(prev => ({
                              ...prev,
                              [outlinePoint.id]: isModified
                            }));

                            updateCombinedPlan(
                              outlinePoint.id,
                              outlinePoint.text,
                              newContent,
                              "main"
                            );
                            // Height will be synced by the MutationObserver
                          }}
                          onHeightChange={() => {
                            // Equalize only the affected pair to reduce scroll jumps
                            syncPairHeights('main', outlinePoint.id);
                          }}
                        />
                      ) : (
                        <div className="relative border rounded-md dark:bg-gray-700 dark:border-gray-600 text-base min-h-[100px]">
                          <div className="absolute top-2 right-2 z-10">
                            <Button
                              className="text-sm px-2 py-1 h-8"
                              onClick={() => toggleEditMode(outlinePoint.id)}
                              variant="default"
                              title={t("plan.editMode")}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="p-3 pr-12">
                            <MarkdownRenderer
                              markdown={generatedContent[outlinePoint.id] || t("plan.noContent")}
                              section="main"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sermon.outline?.main.length === 0 && (
                  <p className="text-gray-500">{t("plan.noSermonPoints")}</p>
                )}
              </div>
            </div>

            {/* Conclusion header */}
            <div ref={conclusionSectionRef} data-section="conclusion" className="lg:col-span-2">
              <SectionHeader section="conclusion" onSwitchPage={handleSwitchToStructure} />
            </div>
            {/* Conclusion Left & Right */}
            <div
              data-testid="plan-conclusion-left-section"
              className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder} ${SERMON_SECTION_COLORS.conclusion.bg} dark:${SERMON_SECTION_COLORS.conclusion.darkBg}`}
            >
              <div className="p-3">
                {sermon.outline?.conclusion.map((outlinePoint) => (
                  <SermonPointCard
                    key={outlinePoint.id}
                    ref={(el) => {
                      if (!conclusionPointRefs.current[outlinePoint.id]) {
                        conclusionPointRefs.current[outlinePoint.id] = { left: null, right: null };
                      }
                      conclusionPointRefs.current[outlinePoint.id].left = el;
                    }}
                    outlinePoint={outlinePoint}
                    thoughts={getThoughtsForSermonPoint(outlinePoint.id)}
                    sectionName="conclusion"
                    onGenerate={generateSermonPointContent}
                    generatedContent={generatedContent[outlinePoint.id] || null}
                    isGenerating={generatingId === outlinePoint.id}
                    sermonId={sermonId}
                    onOpenFragmentsModal={setModalSermonPointId}
                  />
                ))}
                {sermon.outline?.conclusion.length === 0 && (
                  <p className="text-gray-500">{t("plan.noSermonPoints")}</p>
                )}
              </div>
            </div>

            <div
              data-testid="plan-conclusion-right-section"
              className={`rounded-lg overflow-hidden border ${SERMON_SECTION_COLORS.conclusion.border.split(' ')[0]} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder} ${SERMON_SECTION_COLORS.conclusion.bg} dark:${SERMON_SECTION_COLORS.conclusion.darkBg}`}
            >
              <div className="p-3">
                {sermon.outline?.conclusion.map((outlinePoint) => (
                  <div
                    key={outlinePoint.id}
                    ref={(el) => {
                      if (!conclusionPointRefs.current[outlinePoint.id]) {
                        conclusionPointRefs.current[outlinePoint.id] = { left: null, right: null };
                      }
                      conclusionPointRefs.current[outlinePoint.id].right = el;
                    }}
                    className="mb-4 bg-white dark:bg-gray-800 border rounded-lg p-4 shadow-sm"
                  >
                    <h3 className={`font-semibold text-lg mb-2 ${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText} flex justify-between items-center`}>
                      {outlinePoint.text}
                      <div className="flex space-x-2">
                        <Button
                          className="text-sm px-2 py-1 h-8"
                          onClick={() => saveSermonPoint(
                            outlinePoint.id,
                            generatedContent[outlinePoint.id] || "",
                            "conclusion"
                          )}
                          variant={modifiedContent[outlinePoint.id] ? "section" : "default"}
                          sectionColor={modifiedContent[outlinePoint.id] ? SERMON_SECTION_COLORS.conclusion : undefined}
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
                        onClick={() => toggleEditMode(outlinePoint.id)}
                        variant="default"
                        title={editModePoints[outlinePoint.id] ? t("plan.viewMode") : t("plan.editMode")}
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
                          placeholder={t("plan.noContent")}
                          value={generatedContent[outlinePoint.id] || ""}
                          onChange={(e) => {
                            const newContent = e.target.value;
                            // Mark content as modified if it's different from the current saved content
                            const currentSavedContent = sermon.plan?.conclusion?.outlinePoints?.[outlinePoint.id] || "";
                            const isModified = newContent !== currentSavedContent;

                            setGeneratedContent((prev) => ({
                              ...prev,
                              [outlinePoint.id]: newContent,
                            }));

                            // Mark as modified if content changed
                            setModifiedContent(prev => ({
                              ...prev,
                              [outlinePoint.id]: isModified
                            }));

                            updateCombinedPlan(
                              outlinePoint.id,
                              outlinePoint.text,
                              newContent,
                              "conclusion"
                            );
                            // Height will be synced by the MutationObserver
                          }}
                          onHeightChange={() => {
                            // Equalize only the affected pair to reduce scroll jumps
                            syncPairHeights('conclusion', outlinePoint.id);
                          }}
                        />
                      ) : (
                        <div className="relative border rounded-md dark:bg-gray-700 dark:border-gray-600 text-base min-h-[100px]">
                          <div className="absolute top-2 right-2 z-10">
                            <Button
                              className="text-sm px-2 py-1 h-8"
                              onClick={() => toggleEditMode(outlinePoint.id)}
                              variant="default"
                              title={t("plan.editMode")}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="p-3 pr-12">
                            <MarkdownRenderer
                              markdown={generatedContent[outlinePoint.id] || t("plan.noContent")}
                              section="conclusion"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sermon.outline?.conclusion.length === 0 && (
                  <p className="text-gray-500">{t("plan.noSermonPoints")}</p>
                )}
              </div>
            </div>
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
                onThoughtUpdate={handleThoughtUpdate}
              />
            );
          })()}
        </div>
      </div>
    </>
  );
} 
