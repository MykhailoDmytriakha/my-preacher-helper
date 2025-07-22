"use client";

import React, { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { 
  generateTopics, 
  generateRelatedVerses, 
  generatePossibleDirections 
} from "@/services/insights.service";
import { getSermonById } from "@/services/sermon.service";
import { ChevronIcon, RefreshIcon } from '@components/Icons';
import { Sermon, Insights } from '@/models/models';

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
  
  // Loading states
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isGeneratingTopics, setIsGeneratingTopics] = useState(false);
  const [isGeneratingVerses, setIsGeneratingVerses] = useState(false);
  const [isGeneratingDirections, setIsGeneratingDirections] = useState(false);
  
  // Helper to check if any generation is in progress
  const isAnyGenerating = () => {
    return isGeneratingAll || isGeneratingTopics || isGeneratingVerses || isGeneratingDirections;
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

  // Generic function to handle section regeneration
  const regenerateSection = async (
    sectionType: InsightSectionType, 
    regenerationFunction: RegenerationFunction,
    setGeneratingState: React.Dispatch<React.SetStateAction<boolean>>,
    setVisibilityState: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    if (!sermon?.id) {
      console.error(`Cannot generate ${sectionType}: sermon or sermon.id is missing`);
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
    if (!sermon?.id) {
      console.error("Cannot generate insights: sermon or sermon.id is missing");
      return;
    }

    setIsGeneratingAll(true);
    setSuccessNotification(false);
    
    try {
      // Create empty insights object to start with
      const insights: Insights = {
        topics: [],
        relatedVerses: [],
        possibleDirections: []
      };
      
      // Generate all sections sequentially
      const topicsResult = await generateTopics(sermon.id);
      if (topicsResult?.topics) {
        insights.topics = topicsResult.topics;
      }
      
      const versesResult = await generateRelatedVerses(sermon.id);
      if (versesResult?.relatedVerses) {
        insights.relatedVerses = versesResult.relatedVerses;
      }
      
      const directionsResult = await generatePossibleDirections(sermon.id);
      if (directionsResult?.possibleDirections) {
        insights.possibleDirections = directionsResult.possibleDirections;
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
      
    } catch (error) {
      console.error("Failed to generate insights:", error);
    } finally {
      setIsGeneratingAll(false);
      setExpanded(true);
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

  // Data for rendering
  const hasInsights = localInsights && 
                     Array.isArray(localInsights.topics) && 
                     localInsights.topics.length > 0;
  
  // Check if sermon has enough thoughts to generate insights
  const THOUGHTS_THRESHOLD = 10;
  const thoughtsCount = sermon.thoughts?.length || 0;
  const hasEnoughThoughts = thoughtsCount >= THOUGHTS_THRESHOLD;
  const remainingThoughts = THOUGHTS_THRESHOLD - thoughtsCount;
  
  const topics = extractTopics();
  const relatedVerses = getRelatedVerses();
  const possibleDirections = getPossibleDirections();

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
      
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2 flex-shrink-0 max-w-[70%]">
          <h2 className="text-xl font-semibold break-words">{t('knowledge.title')}</h2>
        </div>
        {hasInsights ? (
          <button 
            onClick={() => setExpanded(!expanded)}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 ml-4 flex-shrink-0"
            aria-expanded={expanded}
            aria-label={expanded ? t('knowledge.showLess') : t('knowledge.showMore')}
          >
            <ChevronIcon className={`transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        ) : null}
      </div>
      
      {!expanded ? (
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          {hasInsights ? t('knowledge.clickToExpand') : null}
        </p>
      ) : null}
      
      {hasInsights ? (
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
            <div className="flex flex-wrap gap-2 mt-2">
              {showAllTopics ? topics.map((topic, index) => (
                <span 
                  key={index}
                  className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-sm rounded-md"
                >
                  {topic}
                </span>
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
        </div>
      ) : (
        <div className="mt-4 text-center">
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
        </div>
      )}
    </div>
  );
};

export default KnowledgeSection; 