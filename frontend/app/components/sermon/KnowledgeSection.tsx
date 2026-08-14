"use client";

import { ChevronDownIcon } from '@heroicons/react/20/solid';
import React, { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import "@locales/i18n";
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';
import { useAiUsage } from '@/hooks/useAiUsage';
import { Sermon, Insights, SermonContent, SectionHints } from '@/models/models';
import { useConnection } from '@/providers/ConnectionProvider';
import {
  generateTopics,
  generateRelatedVerses,
  generatePossibleDirections,
  generateThoughtsBasedPlan
} from "@/services/insights.service";
import { isUsageCapReachedError } from '@/services/usageLimits';
import { debugLog } from "@/utils/debugMode";
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';
import { RefreshIcon } from '@components/Icons';
// Same reason as useSeriesDetail: the package default instance holds no resources,
// so these failure messages came out empty.
import { i18n } from '@locales/i18n';

// Translation key constants to avoid duplicate strings
const TRANSLATION_KNOWLEDGE_REFRESH = 'knowledge.refresh';
const TRANSLATION_KNOWLEDGE_SHOW_ALL = 'knowledge.showAll';
const TRANSLATION_KNOWLEDGE_HIDE_ALL = 'knowledge.hideAll';

interface KnowledgeSectionProps {
  sermon: Sermon;
  updateSermon?: (updatedSermon: Sermon) => void;
}

// Types for section regeneration
type InsightSectionType = 'topics' | 'verses' | 'directions';
type RegenerationFunction = (sermonId: string) => Promise<Insights>;

/**
 * SAY IT OUT LOUD when generation fails.
 *
 * Every failure used to end as `null` here, so nothing appeared and nothing was
 * said: a provider error, an exhausted quota and a request killed by the 60s
 * function ceiling were all indistinguishable from "there was nothing to suggest".
 * The person was left watching a block that simply never showed up.
 */
/**
 * When several sections failed, say the thing the person can ACT on. "Split the
 * sermon" is a step they can take; "try again" is not, and reporting whichever
 * failure happened to come first would hide the useful one behind it.
 */
function mostActionable(failures: unknown[]): unknown {
  // An exhausted quota outranks everything else, because it makes every other
  // advice wrong: "try again" cannot work until the quota resets, and the global
  // handler is already saying so. Returning it here means `reportAiFailure` stays
  // silent instead of contradicting that message.
  const capped = failures.find((f) => isUsageCapReachedError(f));
  if (capped) return capped;
  return (
    failures.find((f) => (f as { reason?: unknown } | null)?.reason === 'too-large') ?? failures[0]
  );
}

function reportAiFailure(error: unknown) {
  // An exhausted quota is announced by the global usage handler, with the number
  // and the reset time. Saying "could not generate this" on top of it contradicts
  // that message and invites a retry that cannot work.
  if (isUsageCapReachedError(error)) return;
  // Read the reason off the value rather than testing the class: this runs behind
  // a module boundary that tests and bundlers may replace, and a failed identity
  // check here would throw INSIDE the error path — silence again, now louder.
  const reason = (error as { reason?: unknown } | null | undefined)?.reason;
  toast.error(
    reason === 'too-large'
      ? i18n.t('knowledge.failedTooLarge')
      : i18n.t('knowledge.failedUnavailable')
  );
}

// Constants for repeated CSS classes and text
const REFRESH_BUTTON_CLASSES = "p-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors disabled:opacity-40 disabled:grayscale disabled:cursor-not-allowed";
const TOGGLE_BUTTON_CLASSES = "text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none";

const THOUGHTS_THRESHOLD = 10;

const showSuccessNotification = (
  setSuccessNotification: React.Dispatch<React.SetStateAction<boolean>>
) => {
  setSuccessNotification(true);
  setTimeout(() => setSuccessNotification(false), 3000);
};

const toMarkdownString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join('\n');
  return '';
};

const getSectionHintsFromInsightsOrContent = (
  insights: Insights | undefined,
  content: SermonContent | undefined
): SectionHints | undefined => {
  const shouldLog = process.env.NODE_ENV !== 'test';
  // First try to get from insights.sectionHints
  if (insights?.sectionHints) {
    if (shouldLog) {
      debugLog('🎯 Getting thoughts plan from insights.sectionHints', insights.sectionHints);
    }
    const tp = insights.sectionHints as unknown as Partial<Record<keyof SectionHints, unknown>>;
    return {
      introduction: toMarkdownString(tp?.introduction),
      main: toMarkdownString(tp?.main),
      conclusion: toMarkdownString(tp?.conclusion)
    };
  }

  // If not available in insights, convert sermon content to SectionHints format
  if (shouldLog) {
    debugLog('🎯 Getting thoughts plan from sermon content', content);
  }
  if (content) {
    return {
      introduction: content.introduction.outline,
      main: content.main.outline,
      conclusion: content.conclusion.outline
    };
  }

  return undefined;
};

const applyInsightsUpdate = ({
  sermon,
  updateSermon,
  setLocalInsights,
  insights
}: {
  sermon: Sermon;
  updateSermon?: (updatedSermon: Sermon) => void;
  setLocalInsights: React.Dispatch<React.SetStateAction<Insights | undefined>>;
  insights: Insights;
}) => {
  // Update local state immediately for fast UI refresh
  setLocalInsights(insights);

  // Then update parent if needed
  if (updateSermon) {
    updateSermon({ ...sermon, insights });
  }
};

const regenerateInsightSection = async ({
  sermonId,
  sectionType,
  regenerationFunction,
  setGeneratingState,
  setVisibilityState,
  setSuccessNotification,
  onInsightsUpdated
}: {
  sermonId: string | undefined;
  sectionType: InsightSectionType;
  regenerationFunction: RegenerationFunction;
  setGeneratingState: React.Dispatch<React.SetStateAction<boolean>>;
  setVisibilityState: React.Dispatch<React.SetStateAction<boolean>>;
  setSuccessNotification: React.Dispatch<React.SetStateAction<boolean>>;
  onInsightsUpdated: (insights: Insights) => void;
}) => {
  if (!sermonId) {
    if (sectionType === 'topics') {
      console.error("Cannot generate topics: sermon or sermon.id is missing");
    } else {
      console.error(`Cannot generate ${sectionType}: sermon or sermon.id is missing`);
    }
    return;
  }

  setGeneratingState(true);
  setSuccessNotification(false);

  try {
    const updatedInsights = await regenerationFunction(sermonId);

    if (!updatedInsights) {
      console.error(`Failed to generate ${sectionType} from API`);
      throw new Error(`Failed to generate ${sectionType}`);
    }

    onInsightsUpdated(updatedInsights);
    setVisibilityState(true);

    showSuccessNotification(setSuccessNotification);
  } catch (error) {
    console.error(`Failed to generate ${sectionType}:`, error);
    reportAiFailure(error);
  } finally {
    setGeneratingState(false);
  }
};

const generateAllInsightsForSermon = async ({
  sermonId,
  setIsGeneratingAll,
  setSuccessNotification,
  onInsightsUpdated,
  setShowAllTopics,
  setShowAllVerses,
  setShowAllDirections,
  setExpanded,
  existingInsights,
  generators
}: {
  sermonId: string | undefined;
  setIsGeneratingAll: React.Dispatch<React.SetStateAction<boolean>>;
  setSuccessNotification: React.Dispatch<React.SetStateAction<boolean>>;
  onInsightsUpdated: (insights: Insights) => void;
  setShowAllTopics: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAllVerses: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAllDirections: React.Dispatch<React.SetStateAction<boolean>>;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  existingInsights?: Insights;
  generators: {
    generateTopics: RegenerationFunction;
    generateRelatedVerses: RegenerationFunction;
    generatePossibleDirections: RegenerationFunction;
    generateThoughtsBasedPlan: RegenerationFunction;
  };
}) => {

  if (!sermonId) {
    console.error("Cannot generate insights: sermon or sermon.id is missing");
    return;
  }

  setIsGeneratingAll(true);
  setSuccessNotification(false);

  try {
    /**
     * START FROM WHAT THE SERMON ALREADY HAS, not from empty arrays.
     *
     * This object REPLACES the stored insights wholesale, so any section left empty
     * here is a section deleted from the sermon. Starting blank meant a failed
     * topics call silently wiped topics the person already had — losing content in
     * the name of adding some.
     */
    const insights: Insights = {
      topics: existingInsights?.topics ?? [],
      relatedVerses: existingInsights?.relatedVerses ?? [],
      possibleDirections: existingInsights?.possibleDirections ?? [],
      ...(existingInsights?.sectionHints ? { sectionHints: existingInsights.sectionHints } : {}),
    };

    /**
     * ONE SECTION FAILING MUST NOT THROW AWAY THE OTHERS.
     *
     * Each generator is a separate paid call. Letting the first failure escape
     * would (a) stop the remaining sections from being attempted at all and
     * (b) discard sections that already succeeded — their quota and their minutes
     * spent for nothing. So each is awaited on its own and the partial result is
     * kept; the person is told once, at the end, that something did not come.
     */
    const failures: unknown[] = [];
    const attempt = async (label: string, run: () => Promise<Insights>) => {
      try {
        return await run();
      } catch (error) {
        console.error(`❌ ${label} failed:`, error);
        failures.push(error);
        return null;
      }
    };

    const topicsResult = await attempt('topics', () => generators.generateTopics(sermonId));
    if (topicsResult?.topics) {
      insights.topics = topicsResult.topics;
    }

    const versesResult = await attempt('verses', () => generators.generateRelatedVerses(sermonId));
    if (versesResult?.relatedVerses) {
      insights.relatedVerses = versesResult.relatedVerses;
    }

    const directionsResult = await attempt('directions', () => generators.generatePossibleDirections(sermonId));
    if (directionsResult?.possibleDirections) {
      insights.possibleDirections = directionsResult.possibleDirections;
    }

    const sectionHintsResult = await attempt('plan', () => generators.generateThoughtsBasedPlan(sermonId));
    if (sectionHintsResult?.sectionHints) {
      insights.sectionHints = sectionHintsResult.sectionHints;
    }

    // Whatever DID come back is applied — partial results are still results. But
    // if NOTHING came back there is nothing to apply, and writing the untouched
    // object back would be a no-op dressed as an update.
    const anySucceeded = failures.length < 4;
    if (anySucceeded) onInsightsUpdated(insights);
    if (failures.length > 0) reportAiFailure(mostActionable(failures));

    // Reset visibility states when generating new insights
    setShowAllTopics(true);
    setShowAllVerses(true);
    setShowAllDirections(true);

    // "Generated!" over four failures is a lie the person can see through.
    if (anySucceeded) showSuccessNotification(setSuccessNotification);

  } catch (error) {
    console.error("❌ FAILED to generate insights:", error);
    reportAiFailure(error);
  } finally {
    setIsGeneratingAll(false);
    setExpanded(true);
  }
};

const generateSectionHintsForSermon = async ({
  sermonId,
  setIsGeneratingPlan,
  setSuccessNotification,
  onInsightsUpdated,
  generateThoughtsBasedPlan
}: {
  sermonId: string | undefined;
  setIsGeneratingPlan: React.Dispatch<React.SetStateAction<boolean>>;
  setSuccessNotification: React.Dispatch<React.SetStateAction<boolean>>;
  onInsightsUpdated: (insights: Insights) => void;
  generateThoughtsBasedPlan: RegenerationFunction;
}) => {
  if (!sermonId) {
    console.error("Cannot generate plan hints: sermon or sermon.id is missing");
    return;
  }

  setIsGeneratingPlan(true);
  setSuccessNotification(false);

  try {
    const insights = await generateThoughtsBasedPlan(sermonId);
    if (insights?.sectionHints) {
      onInsightsUpdated(insights);
      showSuccessNotification(setSuccessNotification);
    } else {
      console.error("Failed to generate plan hints");
    }
  } catch (error) {
    console.error("Failed to generate plan hints:", error);
    reportAiFailure(error);
  } finally {
    setIsGeneratingPlan(false);
  }
};

const LoadingSpinner = () => (
  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" data-testid="loading-spinner">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

const SuccessNotification = ({ show, message }: { show: boolean; message: string }) => {
  if (!show) return null;
  return (
    <div className="absolute top-2 right-2 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 px-3 py-1 rounded-full text-sm animate-fade-in-out">
      {message}
    </div>
  );
};

const KnowledgeHeader = ({
  title,
  expanded,
  onToggleExpanded,
  showMoreLabel,
  showLessLabel,
  hideToggle = false
}: {
  title: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  showMoreLabel: string;
  showLessLabel: string;
  hideToggle?: boolean;
}) => (
  <div className="flex justify-between items-center mb-0 sm:mb-4 gap-3">
    <div className="flex items-center gap-2 min-w-0">
      <h2 className="font-semibold text-base truncate text-gray-700 dark:text-gray-200">{title}</h2>
    </div>
    {!hideToggle && (
      <button
        onClick={onToggleExpanded}
        className="p-1 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 rounded-full transition-colors text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        aria-label={expanded ? showLessLabel : showMoreLabel}
      >
        <ChevronDownIcon className={`h-5 w-5 transform transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
    )}
  </div>
);



const EmptyStateGenerateContainer = ({
  hasEnoughThoughts,
  noInsightsMessage,
  thresholdMessage,
  generateLabel,
  isGeneratingAll,
  anyGenerating,
  onGenerate,
  magicUnavailableLabel
}: {
  hasEnoughThoughts: boolean;
  noInsightsMessage: string;
  thresholdMessage: string;
  generateLabel: string;
  isGeneratingAll: boolean;
  anyGenerating: boolean;
  onGenerate: () => void;
  magicUnavailableLabel?: string;
}) => (
  <div className="mt-3 sm:mt-4">
    <div className="flex flex-col items-center gap-4 p-4 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-800/30">
      <div className="w-full text-center">
        {hasEnoughThoughts ? (
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {noInsightsMessage}
          </p>
        ) : (
          <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
            {thresholdMessage}
          </p>
        )}
      </div>

      <button
        className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex items-center justify-center gap-2 transition-all ${hasEnoughThoughts && !magicUnavailableLabel
          ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-50 grayscale'
          }`}
        onClick={hasEnoughThoughts && !magicUnavailableLabel ? onGenerate : undefined}
        disabled={!hasEnoughThoughts || anyGenerating || !!magicUnavailableLabel}
        title={magicUnavailableLabel}
        data-testid="generate-insights-button"
      >
        {isGeneratingAll ? <LoadingSpinner /> : null}
        {magicUnavailableLabel || generateLabel}
      </button>
    </div>
  </div>
);

interface InsightListSectionProps<T> {
  title: string;
  items: T[];
  showAll: boolean;
  onToggleShowAll: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  disableRefresh: boolean;
  refreshLabel: string;
  showAllLabel: string;
  hideAllLabel: string;
  listClassName: string;
  renderItem: (item: T, index: number) => React.ReactNode;
}

function InsightListSection<T>({
  title,
  items,
  showAll,
  onToggleShowAll,
  onRefresh,
  isRefreshing,
  disableRefresh,
  refreshLabel,
  showAllLabel,
  hideAllLabel,
  listClassName,
  renderItem
}: InsightListSectionProps<T>) {
  const hasItems = items.length > 0;

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-gray-900 dark:text-gray-100">{title}</h3>
          <button
            onClick={onRefresh}
            disabled={disableRefresh}
            className={REFRESH_BUTTON_CLASSES}
            aria-label={refreshLabel}
            title={refreshLabel}
          >
            {isRefreshing ? <LoadingSpinner /> : (
              <RefreshIcon className="w-4 h-4" />
            )}
          </button>
        </div>
        {hasItems && (
          <button
            onClick={onToggleShowAll}
            className={TOGGLE_BUTTON_CLASSES}
          >
            {showAll ? hideAllLabel : showAllLabel}
          </button>
        )}
      </div>
      <div className={listClassName}>
        {showAll ? items.map((item, index) => (
          <React.Fragment key={index}>
            {renderItem(item, index)}
          </React.Fragment>
        )) : null}
      </div>
    </div>
  );
}

const PlanSection = ({
  title,
  sectionHints,
  refreshLabel,
  onRefresh,
  isRefreshing,
  disableRefresh,
  noPlanMessage,
  introductionTitle,
  mainTitle,
  conclusionTitle
}: {
  title: string;
  sectionHints: SectionHints | undefined;
  refreshLabel: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  disableRefresh: boolean;
  noPlanMessage: string;
  introductionTitle: string;
  mainTitle: string;
  conclusionTitle: string;
}) => {
  const cards = [
    {
      key: 'introduction',
      title: introductionTitle,
      colors: SERMON_SECTION_COLORS.introduction,
      markdown: sectionHints?.introduction,
      section: 'introduction' as const
    },
    {
      key: 'main',
      title: mainTitle,
      colors: SERMON_SECTION_COLORS.mainPart,
      markdown: sectionHints?.main,
      section: 'main' as const
    },
    {
      key: 'conclusion',
      title: conclusionTitle,
      colors: SERMON_SECTION_COLORS.conclusion,
      markdown: sectionHints?.conclusion,
      section: 'conclusion' as const
    }
  ];

  const visibleCards = cards.filter((card) => Boolean(card.markdown));

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-gray-900 dark:text-gray-100">{title}</h3>
          <button
            onClick={onRefresh}
            disabled={disableRefresh}
            className={REFRESH_BUTTON_CLASSES}
            aria-label={refreshLabel}
            title={refreshLabel}
          >
            {isRefreshing ? <LoadingSpinner /> : (
              <RefreshIcon className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
      <div className="space-y-3 mt-2">
        {visibleCards.length > 0 ? (
          <>
            {visibleCards.map((card) => (
              <div
                key={card.key}
                className={`p-3 rounded-md border ${card.colors.bg} dark:${card.colors.darkBg} ${card.colors.border} dark:${card.colors.darkBorder}`}
              >
                <h4 className={`font-medium mb-1 ${card.colors.text} dark:${card.colors.darkText}`}>
                  {card.title}
                </h4>
                <div className={`text-sm ${card.colors.text} dark:${card.colors.darkText}`}>
                  <MarkdownRenderer markdown={card.markdown as string} section={card.section} />
                </div>
              </div>
            ))}
          </>
        ) : (
          <p className="text-gray-500 dark:text-gray-400 text-sm">{noPlanMessage}</p>
        )}
      </div>
    </div>
  );
};

const KnowledgeSection: React.FC<KnowledgeSectionProps> = ({ sermon, updateSermon }) => {
  const { t } = useTranslation();
  const { isMagicAvailable } = useConnection();
  const { aiBlocked, refresh: refreshAiUsage } = useAiUsage();
  const magicUnavailableLabel = !isMagicAvailable
    ? (t('errors.magicUnavailable') || 'AI features unavailable offline')
    : aiBlocked
      ? t('settings.usage.aiUsageExhausted')
      : undefined;
  const disableNetworkActions = !isMagicAvailable || aiBlocked;

  // UI state
  const [expanded, setExpanded] = useState(false);
  const [successNotification, setSuccessNotification] = useState(false);
  const [showAllTopics, setShowAllTopics] = useState(true);
  const [showAllVerses, setShowAllVerses] = useState(true);
  const [showAllDirections, setShowAllDirections] = useState(true);

  // Keep local insights state for immediate UI updates
  const [localInsights, setLocalInsights] = useState<Insights | undefined>(sermon.insights);
  // Keep local content state for immediate UI updates
  const [localContent, setLocalContent] = useState<SermonContent | undefined>(sermon.draft || sermon.plan);

  // Loading states
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isGeneratingTopics, setIsGeneratingTopics] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isGeneratingVerses, setIsGeneratingVerses] = useState(false);
  const [isGeneratingDirections, setIsGeneratingDirections] = useState(false);

  const anyGenerating = isGeneratingAll || isGeneratingTopics || isGeneratingPlan || isGeneratingVerses || isGeneratingDirections;
  const disableRefresh = anyGenerating || disableNetworkActions;

  const updateInsights = (insights: Insights) =>
    applyInsightsUpdate({ sermon, updateSermon, setLocalInsights, insights });

  // Generate all insights at once
  const handleGenerateAllInsights = async () => {
    await generateAllInsightsForSermon({
      sermonId: sermon?.id,
      setIsGeneratingAll,
      setSuccessNotification,
      onInsightsUpdated: updateInsights,
      setShowAllTopics,
      setShowAllVerses,
      setShowAllDirections,
      setExpanded,
      existingInsights: localInsights ?? sermon?.insights,
      generators: {
        generateTopics,
        generateRelatedVerses,
        generatePossibleDirections,
        generateThoughtsBasedPlan
      }
    });
    await refreshAiUsage();
  };

  // Generate plan for sermon
  const handleGeneratePlan = async () => {
    await generateSectionHintsForSermon({
      sermonId: sermon?.id,
      setIsGeneratingPlan,
      setSuccessNotification,
      onInsightsUpdated: updateInsights,
      generateThoughtsBasedPlan
    });
    await refreshAiUsage();
  };

  // Regenerate individual sections using the generic function
  const handleRegenerateTopics = async () => {
    await regenerateInsightSection({
      sermonId: sermon?.id,
      sectionType: 'topics',
      regenerationFunction: generateTopics,
      setGeneratingState: setIsGeneratingTopics,
      setVisibilityState: setShowAllTopics,
      setSuccessNotification,
      onInsightsUpdated: updateInsights
    });
    await refreshAiUsage();
  };

  const handleRegenerateVerses = async () => {
    await regenerateInsightSection({
      sermonId: sermon?.id,
      sectionType: 'verses',
      regenerationFunction: generateRelatedVerses,
      setGeneratingState: setIsGeneratingVerses,
      setVisibilityState: setShowAllVerses,
      setSuccessNotification,
      onInsightsUpdated: updateInsights
    });
    await refreshAiUsage();
  };

  const handleRegenerateDirections = async () => {
    await regenerateInsightSection({
      sermonId: sermon?.id,
      sectionType: 'directions',
      regenerationFunction: generatePossibleDirections,
      setGeneratingState: setIsGeneratingDirections,
      setVisibilityState: setShowAllDirections,
      setSuccessNotification,
      onInsightsUpdated: updateInsights
    });
    await refreshAiUsage();
  };

  // Toggle visibility functions
  const toggleTopicsVisibility = () => setShowAllTopics(!showAllTopics);
  const toggleVersesVisibility = () => setShowAllVerses(!showAllVerses);
  const toggleDirectionsVisibility = () => setShowAllDirections(!showAllDirections);

  // Effects

  // Keep localInsights in sync with sermon.insights when it changes from props
  useEffect(() => {
    setLocalInsights(sermon.insights);
  }, [sermon.insights]);

  // Keep localContent in sync with sermon draft/plan when it changes from props
  useEffect(() => {
    setLocalContent(sermon.draft || sermon.plan);
  }, [sermon.draft, sermon.plan]);

  useEffect(() => {
    // Reset states when sermon changes
    setSuccessNotification(false);
    setShowAllTopics(true);
    setShowAllVerses(true);
    setShowAllDirections(true);
  }, [sermon.id]);

  // Check if sermon has enough thoughts to generate insights
  const thoughtsCount = sermon.thoughts?.length || 0;
  const hasEnoughThoughts = thoughtsCount >= THOUGHTS_THRESHOLD;
  const remainingThoughts = THOUGHTS_THRESHOLD - thoughtsCount;

  const topics = localInsights?.topics ?? [];
  const relatedVerses = localInsights?.relatedVerses ?? [];
  const possibleDirections = localInsights?.possibleDirections ?? [];
  const sectionHints = getSectionHintsFromInsightsOrContent(localInsights, localContent);

  const hasSectionHints = Boolean(sectionHints && (sectionHints.introduction || sectionHints.main || sectionHints.conclusion));

  // Data for rendering
  // Check if we have any data to show
  const hasAnyData = topics.length > 0 || relatedVerses.length > 0 || possibleDirections.length > 0 || hasSectionHints;
  const insightsThresholdMessage = t('knowledge.insightsThreshold', {
    count: remainingThoughts,
    thoughtsCount: thoughtsCount,
    threshold: THOUGHTS_THRESHOLD,
    defaultValue: `You need {{count}} more thoughts to unlock insights. Currently: ${thoughtsCount}/${THOUGHTS_THRESHOLD}`
  });

  return (
    <div className="p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 relative">
      <SuccessNotification show={successNotification} message={t('knowledge.insightsGenerated')} />

      <KnowledgeHeader
        title={t('knowledge.title')}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((prev) => !prev)}
        showMoreLabel={t('knowledge.showMore')}
        showLessLabel={t('knowledge.showLess')}
        hideToggle={false}
      />



      {expanded ? (
        hasAnyData ? (
          <div className="space-y-6">
            <InsightListSection
              title={t('knowledge.coveredTopics')}
              items={topics}
              showAll={showAllTopics}
              onToggleShowAll={toggleTopicsVisibility}
              onRefresh={handleRegenerateTopics}
              isRefreshing={isGeneratingTopics}
              disableRefresh={disableRefresh}
              refreshLabel={magicUnavailableLabel || t(TRANSLATION_KNOWLEDGE_REFRESH)}
              showAllLabel={t(TRANSLATION_KNOWLEDGE_SHOW_ALL)}
              hideAllLabel={t(TRANSLATION_KNOWLEDGE_HIDE_ALL)}
              listClassName="space-y-2 text-gray-600 dark:text-gray-300 mt-2"
              renderItem={(topic) => (
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                  <div className="font-medium">{topic}</div>
                </div>
              )}
            />

            <InsightListSection
              title={t('knowledge.relatedVerses')}
              items={relatedVerses}
              showAll={showAllVerses}
              onToggleShowAll={toggleVersesVisibility}
              onRefresh={handleRegenerateVerses}
              isRefreshing={isGeneratingVerses}
              disableRefresh={disableRefresh}
              refreshLabel={magicUnavailableLabel || t(TRANSLATION_KNOWLEDGE_REFRESH)}
              showAllLabel={t(TRANSLATION_KNOWLEDGE_SHOW_ALL)}
              hideAllLabel={t(TRANSLATION_KNOWLEDGE_HIDE_ALL)}
              listClassName="space-y-2 text-gray-600 dark:text-gray-300 mt-2"
              renderItem={(verse) => (
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                  <div className="font-medium mb-1">{verse.reference}</div>
                  {verse.relevance && <div className="text-sm">{verse.relevance}</div>}
                </div>
              )}
            />

            <InsightListSection
              title={t('knowledge.possibleDirections')}
              items={possibleDirections}
              showAll={showAllDirections}
              onToggleShowAll={toggleDirectionsVisibility}
              onRefresh={handleRegenerateDirections}
              isRefreshing={isGeneratingDirections}
              disableRefresh={disableRefresh}
              refreshLabel={magicUnavailableLabel || t(TRANSLATION_KNOWLEDGE_REFRESH)}
              showAllLabel={t(TRANSLATION_KNOWLEDGE_SHOW_ALL)}
              hideAllLabel={t(TRANSLATION_KNOWLEDGE_HIDE_ALL)}
              listClassName="space-y-2 mt-2"
              renderItem={(direction) => (
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                  <div className="font-medium mb-1">{direction.area}</div>
                  <div className="text-sm">{direction.suggestion}</div>
                </div>
              )}
            />

            <PlanSection
              title={t('knowledge.suggestedPlan')}
              sectionHints={sectionHints}
              refreshLabel={magicUnavailableLabel || t(TRANSLATION_KNOWLEDGE_REFRESH)}
              onRefresh={handleGeneratePlan}
              isRefreshing={isGeneratingPlan}
              disableRefresh={disableRefresh}
              noPlanMessage={t('knowledge.noPlan')}
              introductionTitle={t('knowledge.planIntroduction')}
              mainTitle={t('knowledge.planMain')}
              conclusionTitle={t('knowledge.planConclusion')}
            />
          </div>
        ) : (
          <EmptyStateGenerateContainer
            hasEnoughThoughts={hasEnoughThoughts}
            noInsightsMessage={t('knowledge.noInsights')}
            thresholdMessage={insightsThresholdMessage}
            generateLabel={t('knowledge.generate')}
            isGeneratingAll={isGeneratingAll}
            anyGenerating={disableRefresh}
            onGenerate={handleGenerateAllInsights}
            magicUnavailableLabel={magicUnavailableLabel}
          />
        )
      ) : null}
    </div>
  );
};

export default KnowledgeSection; 
