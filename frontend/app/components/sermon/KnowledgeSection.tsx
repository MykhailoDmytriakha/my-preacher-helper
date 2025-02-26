"use client";

import React, { useState, useEffect } from "react";
import { Sermon } from "@/models/models";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { generateInsights } from "@/services/insights.service";
import { getSermonById } from "@/services/sermon.service";

interface KnowledgeSectionProps {
  sermon: Sermon;
  updateSermon?: (updatedSermon: Sermon) => void;
}

const KnowledgeSection: React.FC<KnowledgeSectionProps> = ({ sermon, updateSermon }) => {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [successNotification, setSuccessNotification] = useState(false);
  const [visibleTopics, setVisibleTopics] = useState(5); // Start with showing 5 topics
  const [visibleVerses, setVisibleVerses] = useState(5); // Start with showing 5 verses
  const [visibleDirections, setVisibleDirections] = useState(5); // Start with showing 5 directions
  
  // Extract sermon themes and key topics from the thoughts
  const extractTopics = () => {
    if (!sermon || !sermon.thoughts) return [];
    
    if (sermon.insights?.topics && sermon.insights.topics.length > 0) {
      return sermon.insights.topics;
    }
    
    return [];
  };
  
  // Get related Bible verses
  const getRelatedVerses = () => {
    if (sermon.insights?.relatedVerses && sermon.insights.relatedVerses.length > 0) {
      return sermon.insights.relatedVerses;
    }
    
    return [];
  };
  
  // Get possible directions for sermon development
  const getPossibleDirections = () => {
    if (sermon.insights?.possibleDirections && sermon.insights.possibleDirections.length > 0) {
      return sermon.insights.possibleDirections;
    }
    
    return [];
  };

  const handleGenerateInsights = async () => {
    if (!sermon || !sermon.id) {
      console.error("Cannot generate insights: sermon or sermon.id is missing");
      return;
    }

    setIsGenerating(true);
    setSuccessNotification(false);
    
    try {
      // Call the insights service to generate insights
      const insights = await generateInsights(sermon.id);
      
      if (!insights) {
        console.error("Failed to generate insights from API");
        throw new Error("Failed to generate insights");
      }
      
      // In some cases, we might need to refresh the sermon data to get updated insights
      if (updateSermon) {
        // If we have a parent callback to update the sermon
        const updatedSermon = { ...sermon, insights };
        updateSermon(updatedSermon);
      } else {
        // If no parent callback, fetch the updated sermon directly
        const refreshedSermon = await getSermonById(sermon.id);
        if (refreshedSermon) {
          // Update the local sermon object with refreshed data
          sermon.insights = refreshedSermon.insights;
        } else {
          // If we couldn't refresh, at least update the local object
          sermon.insights = insights;
        }
      }
      
      // Reset visibility counters when generating new insights
      setVisibleTopics(5);
      setVisibleVerses(5);
      setVisibleDirections(5);
      
      // Show success notification
      setSuccessNotification(true);
      setTimeout(() => setSuccessNotification(false), 3000);
      
    } catch (error) {
      console.error("Failed to generate insights:", error);
    } finally {
      setIsGenerating(false);
      setExpanded(true);
    }
  };

  // Toggle showing more/less items
  const toggleMoreTopics = () => {
    setVisibleTopics(visibleTopics === 5 ? 10 : 5);
  };
  
  const toggleMoreVerses = () => {
    setVisibleVerses(visibleVerses === 5 ? 10 : 5);
  };
  
  const toggleMoreDirections = () => {
    setVisibleDirections(visibleDirections === 5 ? 10 : 5);
  };

  // Hide success notification when sermon changes
  useEffect(() => {
    setSuccessNotification(false);
    
    // Reset visibility counters when sermon changes
    setVisibleTopics(5);
    setVisibleVerses(5);
    setVisibleDirections(5);
  }, [sermon.id]);

  useEffect(() => {
    // Simulate data loading
    setTimeout(() => {
      setLoading(false);
    }, 500);
  }, [sermon]);

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

  // Check if sermon has insights
  const hasInsights = sermon.insights && 
                     Array.isArray(sermon.insights.topics) && 
                     sermon.insights.topics.length > 0;
  
  const topics = extractTopics();
  const relatedVerses = getRelatedVerses();
  const possibleDirections = getPossibleDirections();

  // Determine if items have "more" to show
  const hasMoreTopics = topics.length > 5;
  const hasMoreVerses = relatedVerses.length > 5;
  const hasMoreDirections = possibleDirections.length > 5;

  return (
    <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 relative">
      {successNotification && (
        <div className="absolute top-2 right-2 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 px-3 py-1 rounded-full text-sm animate-fade-in-out">
          {t('knowledge.insightsGenerated')}
        </div>
      )}
      
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">{t('knowledge.title')}</h2>
          {hasInsights && (
            <button 
              onClick={handleGenerateInsights}
              disabled={isGenerating}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors disabled:opacity-50"
              aria-label={t('knowledge.refresh')}
              title={t('knowledge.refresh')}
            >
              {isGenerating ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
              )}
            </button>
          )}
        </div>
        {hasInsights ? (
          <button 
            onClick={() => setExpanded(!expanded)}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            aria-expanded={expanded}
            aria-label={expanded ? t('knowledge.showLess') : t('knowledge.showMore')}
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              className={`h-5 w-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        ) : null}
      </div>
      
      {!hasInsights ? (
        <div className="flex flex-col items-center justify-center py-6">
          <p className="text-gray-500 dark:text-gray-400 mb-4 text-center">
            {t('knowledge.noInsights')}
          </p>
          <button
            onClick={handleGenerateInsights}
            disabled={isGenerating}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <svg className="inline-block w-4 h-4 mr-2 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {t('knowledge.generating')}
              </>
            ) : (
              t('knowledge.generate')
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('knowledge.coveredTopics')}</h3>
              {hasMoreTopics && (
                <button 
                  onClick={toggleMoreTopics}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
                >
                  {visibleTopics === 5 ? t('knowledge.showMoreItems') : t('knowledge.showLessItems')}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {topics.slice(0, visibleTopics).map((topic, index) => (
                <span 
                  key={index}
                  className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-sm rounded-md"
                >
                  {topic}
                </span>
              ))}
            </div>
          </div>
          
          {expanded && (
            <>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('knowledge.relatedVerses')}</h3>
                  {hasMoreVerses && (
                    <button 
                      onClick={toggleMoreVerses}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
                    >
                      {visibleVerses === 5 ? t('knowledge.showMoreItems') : t('knowledge.showLessItems')}
                    </button>
                  )}
                </div>
                <div className="space-y-2 text-gray-600 dark:text-gray-300 mt-2">
                  {relatedVerses.slice(0, visibleVerses).map((verse, index) => (
                    <div key={index} className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                      {verse}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">{t('knowledge.possibleDirections')}</h3>
                  {hasMoreDirections && (
                    <button 
                      onClick={toggleMoreDirections}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
                    >
                      {visibleDirections === 5 ? t('knowledge.showMoreItems') : t('knowledge.showLessItems')}
                    </button>
                  )}
                </div>
                <div className="space-y-2 mt-2">
                  {possibleDirections.slice(0, visibleDirections).map((direction, index) => (
                    <div key={index} className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                      {direction}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default KnowledgeSection; 