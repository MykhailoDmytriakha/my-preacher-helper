"use client";

import React, { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { 
  generateTopics, 
  generateRelatedVerses, 
  generatePossibleDirections,
  generateThoughtsBasedPlan
} from "@/services/insights.service";
import { generateSermonPlan } from "@/services/plan.service";
import { getSermonById } from "@/services/sermon.service";
import { ChevronIcon, RefreshIcon } from '@components/Icons';
import { Sermon, Insights, Plan } from '@/models/models';
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';

interface KnowledgeSectionProps {
  sermon: Sermon;
  updateSermon?: (updatedSermon: Sermon) => void;
}

// Types for section regeneration
type InsightSectionType = 'topics' | 'verses' | 'directions';
type RegenerationFunction = (sermonId: string) => Promise<Insights | null>;

const KnowledgeSection: React.FC<KnowledgeSectionProps> = ({ sermon, updateSermon }) => {
  const { t, i18n } = useTranslation();
  
  // UI state
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [successNotification, setSuccessNotification] = useState(false);
  const [showAllTopics, setShowAllTopics] = useState(true);
  const [showAllVerses, setShowAllVerses] = useState(true);
  const [showAllDirections, setShowAllDirections] = useState(true);
  
  // Keep local insights state for immediate UI updates
  const [localInsights, setLocalInsights] = useState<Insights | undefined>(sermon.insights);
  // Keep local plan state for immediate UI updates
  const [localPlan, setLocalPlan] = useState<Plan | undefined>(sermon.plan);
  
  // Loading states
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isGeneratingTopics, setIsGeneratingTopics] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isGeneratingVerses, setIsGeneratingVerses] = useState(false);
  const [isGeneratingDirections, setIsGeneratingDirections] = useState(false);
  
  // Helper to check if any generation is in progress
  const isAnyGenerating = () => {
    return isGeneratingAll || isGeneratingTopics || isGeneratingPlan || isGeneratingVerses || isGeneratingDirections;
  };
  
  // Data extraction functions
  const extractTopics = () => {
    if (!localInsights?.topics?.length) return [];
    return localInsights.topics;
  };
  
  const getRelatedVerses = () => {
    if (!localInsights?.relatedVerses?.length) return [];
    return localInsights.relatedVerses;
  };
  
  const getPossibleDirections = () => {
    if (!localInsights?.possibleDirections?.length) return [];
    return localInsights.possibleDirections;
  };

  // Get plan sections
  const getPlan = () => {
    return localPlan;
  };

  // Get thoughts plan from insights or sermon plan
  const getThoughtsPlan = () => {
    // First try to get from insights.thoughtsPlan
    if (localInsights?.thoughtsPlan) {
      return localInsights.thoughtsPlan;
    }
    // If not available in insights, convert sermon.plan to ThoughtsPlan format
    if (localPlan) {
      return {
        introduction: localPlan.introduction.outline,
        main: localPlan.main.outline,
        conclusion: localPlan.conclusion.outline
      };
    }
    return undefined;
  };

  // Update sermon with new insights
  const updateSermonWithInsights = (insights: Insights) => {
    // Update local state immediately for fast UI refresh
    setLocalInsights(insights);
    
    // Then update parent if needed
    if (updateSermon) {
      const updatedSermon = { ...sermon, insights };
      updateSermon(updatedSermon);
    }
    // No need for getSermonById anymore as we're already updating our local state
  };

  // Update sermon with new plan
  const updateSermonWithPlan = (plan: Plan) => {
    // Update local state immediately for fast UI refresh
    setLocalPlan(plan);
    
    // Then update parent if needed
    if (updateSermon) {
      const updatedSermon = { ...sermon, plan };
      updateSermon(updatedSermon);
    }
  };

  // Generic function to handle section regeneration
  const regenerateSection = async (
    sectionType: InsightSectionType, 
    regenerationFunction: RegenerationFunction,
    setGeneratingState: React.Dispatch<React.SetStateAction<boolean>>,
    setVisibilityState: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    if (!sermon?.id) {
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
      const updatedInsights = await regenerationFunction(sermon.id);
      
      if (!updatedInsights) {
        console.error(`Failed to generate ${sectionType} from API`);
        throw new Error(`Failed to generate ${sectionType}`);
      }
      
      updateSermonWithInsights(updatedInsights);
      setVisibilityState(true);
      
      // Show success notification
      setSuccessNotification(true);
      setTimeout(() => setSuccessNotification(false), 3000);
      
    } catch (error) {
      console.error(`Failed to generate ${sectionType}:`, error);
    } finally {
      setGeneratingState(false);
    }
  };
  
  // Generate all insights at once
  const handleGenerateAllInsights = async () => {
    console.log('🎯 START handleGenerateAllInsights');
    
    if (!sermon?.id) {
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
      const topicsResult = await generateTopics(sermon.id);
      if (topicsResult?.topics) {
        insights.topics = topicsResult.topics;
        console.log('✅ Topics generated:', topicsResult.topics.length);
      }
      
      console.log('🎯 Starting verses generation...');
      const versesResult = await generateRelatedVerses(sermon.id);
      if (versesResult?.relatedVerses) {
        insights.relatedVerses = versesResult.relatedVerses;
        console.log('✅ Verses generated:', versesResult.relatedVerses.length);
      }
      
      console.log('🎯 Starting directions generation...');
      const directionsResult = await generatePossibleDirections(sermon.id);
      if (directionsResult?.possibleDirections) {
        insights.possibleDirections = directionsResult.possibleDirections;
        console.log('✅ Directions generated:', directionsResult.possibleDirections.length);
      }

      console.log('🎯 Starting thoughts plan generation...');
      // Generate thoughts-based plan
      const thoughtsPlanResult = await generateThoughtsBasedPlan(sermon.id);
      if (thoughtsPlanResult?.thoughtsPlan) {
        insights.thoughtsPlan = thoughtsPlanResult.thoughtsPlan;
      }
      

      // Update the sermon with all new insights
      updateSermonWithInsights(insights);
      
      // Reset visibility states when generating new insights
      setShowAllTopics(true);
      setShowAllVerses(true);
      setShowAllDirections(true);
      
      // Show success notification
      setSuccessNotification(true);
      setTimeout(() => setSuccessNotification(false), 3000);
      
      console.log('🎉 COMPLETED handleGenerateAllInsights successfully');
    } catch (error) {
      console.error("❌ FAILED to generate insights:", error);
    } finally {
      setIsGeneratingAll(false);
      setExpanded(true);
    }
  };
  
  // Generate plan for sermon
  const handleGeneratePlan = async () => {
    if (!sermon?.id) {
      console.error("Cannot generate plan: sermon or sermon.id is missing");
      return;
    }

    setIsGeneratingPlan(true);
    setSuccessNotification(false);
    
    try {
      const plan = await generateSermonPlan(sermon.id);
      if (plan) {
        updateSermonWithPlan(plan);
        
        // Show success notification
        setSuccessNotification(true);
        setTimeout(() => setSuccessNotification(false), 3000);
      }
    } catch (error) {
      console.error("Failed to generate plan:", error);
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  // Regenerate individual sections using the generic function
  const handleRegenerateTopics = () => 
    regenerateSection('topics', generateTopics, setIsGeneratingTopics, setShowAllTopics);
  
  const handleRegenerateVerses = () => 
    regenerateSection('verses', generateRelatedVerses, setIsGeneratingVerses, setShowAllVerses);
  
  const handleRegenerateDirections = () => 
    regenerateSection('directions', generatePossibleDirections, setIsGeneratingDirections, setShowAllDirections);
  
  // Toggle visibility functions
  const toggleTopicsVisibility = () => setShowAllTopics(!showAllTopics);
  const toggleVersesVisibility = () => setShowAllVerses(!showAllVerses);
  const toggleDirectionsVisibility = () => setShowAllDirections(!showAllDirections);

  // Effects
  
  // Keep localInsights in sync with sermon.insights when it changes from props
  useEffect(() => {
    setLocalInsights(sermon.insights);
  }, [sermon.insights]);

  // Keep localPlan in sync with sermon.plan when it changes from props
  useEffect(() => {
    setLocalPlan(sermon.plan);
  }, [sermon.plan]);
  
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
  const THOUGHTS_THRESHOLD = 10;
  const thoughtsCount = sermon.thoughts?.length || 0;
  const hasEnoughThoughts = thoughtsCount >= THOUGHTS_THRESHOLD;
  const remainingThoughts = THOUGHTS_THRESHOLD - thoughtsCount;
  
  const topics = extractTopics();
  const relatedVerses = getRelatedVerses();
  const possibleDirections = getPossibleDirections();
  const thoughtsPlan = getThoughtsPlan();
  
  // Debug logging (commented out for production)
  // console.log('🔍 Debug Plan:', {
  //   localInsights,
  //   thoughtsPlan,
  //   'thoughtsPlan.introduction': thoughtsPlan?.introduction,
  //   'thoughtsPlan.main': thoughtsPlan?.main,
  //   'thoughtsPlan.conclusion': thoughtsPlan?.conclusion
  // });
  
  const hasThoughtsPlan = thoughtsPlan && (thoughtsPlan.introduction || thoughtsPlan.main || thoughtsPlan.conclusion);
  
  // Data for rendering
  const hasInsights = (localInsights && 
                     Array.isArray(localInsights.topics) && 
                     localInsights.topics.length > 0) || hasThoughtsPlan;
  
  // Check if we have any data to show
  const hasAnyData = topics.length > 0 || relatedVerses.length > 0 || possibleDirections.length > 0 || hasThoughtsPlan;

  // Reusable components
  const LoadingSpinner = () => (
    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" data-testid="loading-spinner">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );

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
      {successNotification && (
        <div className="absolute top-2 right-2 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 px-3 py-1 rounded-full text-sm animate-fade-in-out">
          {t('knowledge.insightsGenerated')}
        </div>
      )}
      
      <div className="flex justify-between items-center mb-4 gap-3">
        <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
          <h2 className="text-xl font-semibold break-words">{t('knowledge.title')}</h2>
        </div>
        <button 
          onClick={() => setExpanded(!expanded)}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          aria-label={expanded ? t('knowledge.showLess') : t('knowledge.showMore')}
        >
          <ChevronIcon className={`transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      
      {!expanded ? (
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          {t('knowledge.clickToExpand')}
        </p>
      ) : null}
      
      {expanded ? (
        <div className="space-y-6">
          {/* Topics section */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('knowledge.coveredTopics')}</h3>
                <button 
                  onClick={handleRegenerateTopics}
                  disabled={isAnyGenerating()}
                  className="p-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors disabled:opacity-50"
                  aria-label={t('knowledge.refresh')}
                  title={t('knowledge.refresh')}
                >
                  {isGeneratingTopics ? <LoadingSpinner /> : (
                    <RefreshIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
              {topics.length > 0 && (
                <button 
                  onClick={toggleTopicsVisibility}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
                >
                  {showAllTopics ? t('knowledge.hideAll') : t('knowledge.showAll')}
                </button>
              )}
            </div>
            <div className="space-y-2 text-gray-600 dark:text-gray-300 mt-2">
              {showAllTopics ? topics.map((topic, index) => (
                <div key={index} className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                  <div className="font-medium">{topic}</div>
                </div>
              )) : null}
            </div>
          </div>
          
          {/* Related verses section */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('knowledge.relatedVerses')}</h3>
                <button 
                  onClick={handleRegenerateVerses}
                  disabled={isAnyGenerating()}
                  className="p-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors disabled:opacity-50"
                  aria-label={t('knowledge.refresh')}
                  title={t('knowledge.refresh')}
                >
                  {isGeneratingVerses ? <LoadingSpinner /> : (
                    <RefreshIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
              {relatedVerses.length > 0 && (
                <button 
                  onClick={toggleVersesVisibility}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
                >
                  {showAllVerses ? t('knowledge.hideAll') : t('knowledge.showAll')}
                </button>
              )}
            </div>
            <div className="space-y-2 text-gray-600 dark:text-gray-300 mt-2">
              {showAllVerses ? relatedVerses.map((verse, index) => (
                <div key={index} className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                  <div className="font-medium mb-1">{verse.reference}</div>
                  {verse.relevance && <div className="text-sm">{verse.relevance}</div>}
                </div>
              )) : null}
            </div>
          </div>
          
          {/* Possible directions section */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('knowledge.possibleDirections')}</h3>
                <button 
                  onClick={handleRegenerateDirections}
                  disabled={isAnyGenerating()}
                  className="p-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors disabled:opacity-50"
                  aria-label={t('knowledge.refresh')}
                  title={t('knowledge.refresh')}
                >
                  {isGeneratingDirections ? <LoadingSpinner /> : (
                    <RefreshIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
              {possibleDirections.length > 0 && (
                <button 
                  onClick={toggleDirectionsVisibility}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
                >
                  {showAllDirections ? t('knowledge.hideAll') : t('knowledge.showAll')}
                </button>
              )}
            </div>
            <div className="space-y-2 mt-2">
              {showAllDirections ? possibleDirections.map((direction, index) => (
                <div key={index} className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                  <div className="font-medium mb-1">{direction.area}</div>
                  <div className="text-sm">{direction.suggestion}</div>
                </div>
              )) : null}
            </div>
          </div>
          
          {/* Plan section */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('knowledge.suggestedPlan')}</h3>
                <button 
                  onClick={handleGeneratePlan}
                  disabled={isAnyGenerating()}
                  className="p-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors disabled:opacity-50"
                  aria-label={t('knowledge.refresh')}
                  title={t('knowledge.refresh')}
                >
                  {isGeneratingPlan ? <LoadingSpinner /> : (
                    <RefreshIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="space-y-3 mt-2">
              {hasThoughtsPlan ? (
                <>
                  {thoughtsPlan?.introduction && (
                    <div className={`p-3 rounded-md border ${SERMON_SECTION_COLORS.introduction.bg} dark:${SERMON_SECTION_COLORS.introduction.darkBg} ${SERMON_SECTION_COLORS.introduction.border} dark:${SERMON_SECTION_COLORS.introduction.darkBorder}`}>
                      <h4 className={`font-medium mb-1 ${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText}`}>{t('knowledge.planIntroduction')}</h4>
                      <div className={`text-sm ${SERMON_SECTION_COLORS.introduction.text} dark:${SERMON_SECTION_COLORS.introduction.darkText}`}>
                        <MarkdownRenderer markdown={thoughtsPlan.introduction} section="introduction" />
                      </div>
                    </div>
                  )}
                  {thoughtsPlan?.main && (
                    <div className={`p-3 rounded-md border ${SERMON_SECTION_COLORS.mainPart.bg} dark:${SERMON_SECTION_COLORS.mainPart.darkBg} ${SERMON_SECTION_COLORS.mainPart.border} dark:${SERMON_SECTION_COLORS.mainPart.darkBorder}`}>
                      <h4 className={`font-medium mb-1 ${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText}`}>{t('knowledge.planMain')}</h4>
                      <div className={`text-sm ${SERMON_SECTION_COLORS.mainPart.text} dark:${SERMON_SECTION_COLORS.mainPart.darkText}`}>
                        <MarkdownRenderer markdown={thoughtsPlan.main} section="main" />
                      </div>
                    </div>
                  )}
                  {thoughtsPlan?.conclusion && (
                    <div className={`p-3 rounded-md border ${SERMON_SECTION_COLORS.conclusion.bg} dark:${SERMON_SECTION_COLORS.conclusion.darkBg} ${SERMON_SECTION_COLORS.conclusion.border} dark:${SERMON_SECTION_COLORS.conclusion.darkBorder}`}>
                      <h4 className={`font-medium mb-1 ${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText}`}>{t('knowledge.planConclusion')}</h4>
                      <div className={`text-sm ${SERMON_SECTION_COLORS.conclusion.text} dark:${SERMON_SECTION_COLORS.conclusion.darkText}`}>
                        <MarkdownRenderer markdown={thoughtsPlan.conclusion} section="conclusion" />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-sm">{t('knowledge.noPlan')}</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 text-center">
          {!hasAnyData ? (
            <>
              {hasEnoughThoughts ? (
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  {t('knowledge.noInsights')}
                </p>
              ) : null}
              
              {!hasEnoughThoughts ? (
                <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md">
                  <p>
                    {t('knowledge.insightsThreshold', {
                      count: remainingThoughts,
                      thoughtsCount: thoughtsCount,
                      threshold: THOUGHTS_THRESHOLD,
                      defaultValue: `You need {{count}} more thoughts to unlock insights. Currently: ${thoughtsCount}/${THOUGHTS_THRESHOLD}`
                    })}
                  </p>
                </div>
              ) : null}
              
              <button
                className={`px-4 py-2 rounded-md font-medium flex items-center justify-center gap-2 w-auto mx-auto ${
                  hasEnoughThoughts
                    ? 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                }`}
                onClick={hasEnoughThoughts ? handleGenerateAllInsights : undefined}
                disabled={!hasEnoughThoughts || isAnyGenerating()}
                data-testid="generate-insights-button"
              >
                {isGeneratingAll ? <LoadingSpinner /> : null}
                {t('knowledge.generate')}
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default KnowledgeSection; 