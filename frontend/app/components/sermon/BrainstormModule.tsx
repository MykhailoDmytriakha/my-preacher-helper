"use client";

import { useState } from 'react';
import { LightBulbIcon } from '@components/Icons';
import { BrainstormSuggestion } from '@/models/models';
import { generateBrainstormSuggestion } from '@/services/brainstorm.service';
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardIcon, XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

interface BrainstormModuleProps {
  sermonId: string;
  className?: string;
}

export default function BrainstormModule({ sermonId, className = "" }: BrainstormModuleProps) {
  const [currentSuggestion, setCurrentSuggestion] = useState<BrainstormSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleGenerateSuggestion = async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      const suggestion = await generateBrainstormSuggestion(sermonId);
      setCurrentSuggestion(suggestion);
    } catch (error) {
      console.error("Error generating brainstorm suggestion:", error);
      toast.error(t('errors.brainstormGenerationError') || 'Failed to generate suggestion. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopySuggestion = () => {
    if (!currentSuggestion?.text) return;
    navigator.clipboard.writeText(currentSuggestion.text);
    toast.success(t('brainstorm.copiedToClipboard') || 'Suggestion copied to clipboard!');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleToggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  const handleClose = () => {
    setIsExpanded(false);
  };

  // Get complexity badge styling based on complexity level
  const getComplexityStyle = (complexity?: string) => {
    switch (complexity) {
      case 'multi-dimensional':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-700';
      case 'high':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700';
      case 'moderate':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-700';
      case 'basic':
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600';
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Collapsed State */}
      {!isExpanded && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          onClick={handleToggleExpanded}
        >
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <LightBulbIcon className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('brainstorm.title')}
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                {t('brainstorm.subtitle')}
              </p>
            </div>
          </div>
          <ChevronDownIcon className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </motion.div>
      )}

      {/* Expanded State */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700 shadow-sm"
        >
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  <LightBulbIcon className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {t('brainstorm.title')}
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    {t('brainstorm.subtitle')}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateSuggestion}
                  disabled={isLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-yellow-200 dark:border-yellow-700 shadow-sm hover:shadow"
                  aria-label={currentSuggestion ? t('brainstorm.generateAnother') : t('brainstorm.generateButton')}
                >
                  <LightBulbIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                  {isLoading
                    ? t('brainstorm.generating')
                    : currentSuggestion
                      ? t('brainstorm.generateAnother')
                      : t('brainstorm.generateButton')}
                </button>
                
                <button
                  onClick={handleClose}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  aria-label={t('actions.close')}
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Suggestion Display */}
            <AnimatePresence mode="wait">
              {currentSuggestion ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div className="p-4 bg-yellow-50 dark:bg-yellow-900/10 rounded-lg border border-yellow-200 dark:border-yellow-700">
                    <p className="text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                      {currentSuggestion.text}
                    </p>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full text-sm font-medium">
                        {t(`brainstorm.types.${currentSuggestion.type}`)}
                      </span>
                      
                      {currentSuggestion.complexity && (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getComplexityStyle(currentSuggestion.complexity)}`}>
                          {t(`brainstorm.complexity.${currentSuggestion.complexity}`)}
                        </span>
                      )}
                      
                      {currentSuggestion.dimensions && currentSuggestion.dimensions.length > 0 && (
                        <div className="flex items-center gap-1">
                          {currentSuggestion.dimensions.slice(0, 2).map((dimension, index) => (
                            <span 
                              key={index}
                              className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded text-xs font-medium"
                            >
                              {dimension}
                            </span>
                          ))}
                          {currentSuggestion.dimensions.length > 2 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              +{currentSuggestion.dimensions.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleCopySuggestion}
                        className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-yellow-600 dark:hover:text-yellow-400 transition-colors"
                        aria-label={t('brainstorm.copySuggestion')}
                      >
                        <ClipboardIcon className="w-4 h-4" />
                        {copied ? t('brainstorm.copied') : t('brainstorm.copy')}
                        {copied && (
                          <span className="ml-1 text-green-600 dark:text-green-400 text-xs font-semibold transition-opacity">✔</span>
                        )}
                      </button>
                      
                      <button
                        onClick={handleGenerateSuggestion}
                        disabled={isLoading}
                        className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-700 dark:hover:text-yellow-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                      >
                        {t('brainstorm.newSuggestion')}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-8"
                >
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    {t('brainstorm.clickToStart')}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </div>
  );
}