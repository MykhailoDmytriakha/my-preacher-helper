"use client";

import React, { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';

import "@locales/i18n";
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Sermon, Insights, SermonContent, SectionHints } from '@/models/models';
import {
  generateTopics,
  generateRelatedVerses,
  generatePossibleDirections,
  generateThoughtsBasedPlan
} from "@/services/insights.service";
import { debugLog } from "@/utils/debugMode";
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';
import { ChevronIcon, RefreshIcon } from '@components/Icons';

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
type RegenerationFunction = (sermonId: string) => Promise<Insights | null>;

// Use direct translation calls to avoid duplicate string warnings

// Constants for repeated CSS classes and text
const REFRESH_BUTTON_CLASSES = "p-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors disabled:opacity-50";
const TOGGLE_BUTTON_CLASSES = "text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none";
// Use direct translation calls with unique fallback values

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
  generators: {
    generateTopics: RegenerationFunction;
    generateRelatedVerses: RegenerationFunction;
    generatePossibleDirections: RegenerationFunction;
    generateThoughtsBasedPlan: RegenerationFunction;
  };
}) => {
  console.log('🎯 START handleGenerateAllInsights');

  if (!sermonId) {
    console.error("Cannot generate insights: sermon or sermon.id is missing");
    return;
  }

  setIsGeneratingAll(true);
  setSuccessNotification(false);

  try {
    console.log('📝 Creating empty insights object');
    // Create empty insights object to start with
    const insights: Insights = {
      topics: [],
      relatedVerses: [],
      possibleDirections: []
    };

    console.log('🎯 Starting topics generation...');
    // Generate all sections sequentially
    const topicsResult = await generators.generateTopics(sermonId);
    if (topicsResult?.topics) {
      insights.topics = topicsResult.topics;
      console.log('✅ Topics generated:', topicsResult.topics.length);
    }

    console.log('🎯 Starting verses generation...');
    const versesResult = await generators.generateRelatedVerses(sermonId);
    if (versesResult?.relatedVerses) {
      insights.relatedVerses = versesResult.relatedVerses;
      console.log('✅ Verses generated:', versesResult.relatedVerses.length);
    }

    console.log('🎯 Starting directions generation...');
    const directionsResult = await generators.generatePossibleDirections(sermonId);
    if (directionsResult?.possibleDirections) {
      insights.possibleDirections = directionsResult.possibleDirections;
      console.log('✅ Directions generated:', directionsResult.possibleDirections.length);
    }

    console.log('🎯 Starting thoughts plan generation...');
    // Generate thoughts-based plan
    const sectionHintsResult = await generators.generateThoughtsBasedPlan(sermonId);
    if (sectionHintsResult?.sectionHints) {
      insights.sectionHints = sectionHintsResult.sectionHints;
    }

    // Update the sermon with all new insights
    onInsightsUpdated(insights);

    // Reset visibility states when generating new insights
    setShowAllTopics(true);
    setShowAllVerses(true);
    setShowAllDirections(true);

    showSuccessNotification(setSuccessNotification);

    console.log('🎉 COMPLETED handleGenerateAllInsights successfully');
  } catch (error) {
    console.error("❌ FAILED to generate insights:", error);
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
  generateThoughtsBasedPlan: (sermonId: string) => Promise<Insights | null>;
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
  showLessLabel
}: {
  title: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  showMoreLabel: string;
  showLessLabel: string;
}) => (
  <div className="flex justify-between items-center mb-4 gap-3">
    <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
      <h2 className="text-xl font-semibold break-words">{title}</h2>
    </div>
    <button
      onClick={onToggleExpanded}
      className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
      aria-label={expanded ? showLessLabel : showMoreLabel}
    >
      <ChevronIcon className={`transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
  </div>
);

const CollapsedHint = ({ expanded, message }: { expanded: boolean; message: string }) => {
  if (expanded) return null;
  return (
    <p className="text-gray-600 dark:text-gray-400 text-sm">
      {message}
    </p>
  );
};

const CollapsedGenerateContainer = ({
  hasAnyData,
  hasEnoughThoughts,
  noInsightsMessage,
  thresholdMessage,
  generateLabel,
  isGeneratingAll,
  anyGenerating,
  onGenerate
}: {
  hasAnyData: boolean;
  hasEnoughThoughts: boolean;
  noInsightsMessage: string;
  thresholdMessage: string;
  generateLabel: string;
  isGeneratingAll: boolean;
  anyGenerating: boolean;
  onGenerate: () => void;
}) => (
  <div className="mt-4 text-center">
    {!hasAnyData ? (
      <>
        {hasEnoughThoughts ? (
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {noInsightsMessage}
          </p>
        ) : null}

        {!hasEnoughThoughts ? (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md">
            <p>{thresholdMessage}</p>
          </div>
        ) : null}

        <button
          className={`px-4 py-2 rounded-md font-medium flex items-center justify-center gap-2 w-auto mx-auto ${hasEnoughThoughts
            ? 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white'
            : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
            }`}
          onClick={hasEnoughThoughts ? onGenerate : undefined}
          disabled={!hasEnoughThoughts || anyGenerating}
          data-testid="generate-insights-button"
        >
          {isGeneratingAll ? <LoadingSpinner /> : null}
          {generateLabel}
        </button>
      </>
    ) : null}
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
  const isOnline = useOnlineStatus();
  const disableNetworkActions = !isOnline;

  // UI state
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
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
  const handleGenerateAllInsights = () =>
    generateAllInsightsForSermon({
      sermonId: sermon?.id,
      setIsGeneratingAll,
      setSuccessNotification,
      onInsightsUpdated: updateInsights,
      setShowAllTopics,
      setShowAllVerses,
      setShowAllDirections,
      setExpanded,
      generators: {
        generateTopics,
        generateRelatedVerses,
        generatePossibleDirections,
        generateThoughtsBasedPlan
      }
    });

  // Generate plan for sermon
  const handleGeneratePlan = () =>
    generateSectionHintsForSermon({
      sermonId: sermon?.id,
      setIsGeneratingPlan,
      setSuccessNotification,
      onInsightsUpdated: updateInsights,
      generateThoughtsBasedPlan
    });

  // Regenerate individual sections using the generic function
  const handleRegenerateTopics = () =>
    regenerateInsightSection({
      sermonId: sermon?.id,
      sectionType: 'topics',
      regenerationFunction: generateTopics,
      setGeneratingState: setIsGeneratingTopics,
      setVisibilityState: setShowAllTopics,
      setSuccessNotification,
      onInsightsUpdated: updateInsights
    });

  const handleRegenerateVerses = () =>
    regenerateInsightSection({
      sermonId: sermon?.id,
      sectionType: 'verses',
      regenerationFunction: generateRelatedVerses,
      setGeneratingState: setIsGeneratingVerses,
      setVisibilityState: setShowAllVerses,
      setSuccessNotification,
      onInsightsUpdated: updateInsights
    });

  const handleRegenerateDirections = () =>
    regenerateInsightSection({
      sermonId: sermon?.id,
      sectionType: 'directions',
      regenerationFunction: generatePossibleDirections,
      setGeneratingState: setIsGeneratingDirections,
      setVisibilityState: setShowAllDirections,
      setSuccessNotification,
      onInsightsUpdated: updateInsights
    });

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

  useEffect(() => {
    // Simulate data loading
    setTimeout(() => setLoading(false), 500);
  }, [sermon]);

  // Check if sermon has enough thoughts to generate insights
  const thoughtsCount = sermon.thoughts?.length || 0;
  const hasEnoughThoughts = thoughtsCount >= THOUGHTS_THRESHOLD;
  const remainingThoughts = THOUGHTS_THRESHOLD - thoughtsCount;

  const topics = localInsights?.topics ?? [];
  const relatedVerses = localInsights?.relatedVerses ?? [];
  const possibleDirections = localInsights?.possibleDirections ?? [];
  const sectionHints = getSectionHintsFromInsightsOrContent(localInsights, localContent);

  // Debug logging (commented out for production)
  // console.log('🔍 Debug Plan:', {
  //   localInsights,
  //   sectionHints,
  //   'sectionHints.introduction': sectionHints?.introduction,
  //   'sectionHints.main': sectionHints?.main,
  //   'sectionHints.conclusion': sectionHints?.conclusion
  // });

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

  // Loading placeholder
  if (loading) {
    return (
      <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 relative">
      <SuccessNotification show={successNotification} message={t('knowledge.insightsGenerated')} />

      <KnowledgeHeader
        title={t('knowledge.title')}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((prev) => !prev)}
        showMoreLabel={t('knowledge.showMore')}
        showLessLabel={t('knowledge.showLess')}
      />

      <CollapsedHint expanded={expanded} message={t('knowledge.clickToExpand')} />

      {expanded ? (
        <div className="space-y-6">
          <InsightListSection
            title={t('knowledge.coveredTopics')}
            items={topics}
            showAll={showAllTopics}
            onToggleShowAll={toggleTopicsVisibility}
            onRefresh={handleRegenerateTopics}
            isRefreshing={isGeneratingTopics}
            disableRefresh={disableRefresh}
            refreshLabel={t(TRANSLATION_KNOWLEDGE_REFRESH)}
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
            refreshLabel={t(TRANSLATION_KNOWLEDGE_REFRESH)}
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
            refreshLabel={t(TRANSLATION_KNOWLEDGE_REFRESH)}
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
            refreshLabel={t(TRANSLATION_KNOWLEDGE_REFRESH)}
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
        <CollapsedGenerateContainer
          hasAnyData={hasAnyData}
          hasEnoughThoughts={hasEnoughThoughts}
          noInsightsMessage={t('knowledge.noInsights')}
          thresholdMessage={insightsThresholdMessage}
          generateLabel={t('knowledge.generate')}
          isGeneratingAll={isGeneratingAll}
          anyGenerating={disableRefresh}
          onGenerate={handleGenerateAllInsights}
        />
      )}
    </div>
  );
};

export default KnowledgeSection; 
