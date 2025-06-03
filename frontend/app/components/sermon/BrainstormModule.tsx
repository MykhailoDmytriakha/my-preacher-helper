"use client";

import { useState } from 'react';
import { LightBulbIcon } from '@components/Icons';
import { BrainstormSuggestion } from '@/models/models';
import { generateBrainstormSuggestion } from '@/services/brainstorm.service';
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { toast } from 'sonner';

interface BrainstormModuleProps {
  sermonId: string;
  className?: string;
}

export default function BrainstormModule({ sermonId, className = "" }: BrainstormModuleProps) {
  const [currentSuggestion, setCurrentSuggestion] = useState<BrainstormSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation();

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

  return (
    <div className={`p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 ${className}`}>
      {/* Header - горизонтальная компоновка */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <LightBulbIcon className="w-5 h-5 text-yellow-500 dark:text-yellow-400" />
          <h3 className="text-base font-medium text-gray-900 dark:text-white">
            {t('brainstorm.title')}
          </h3>
        </div>
        
        <button
          onClick={handleGenerateSuggestion}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:hover:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-yellow-200 dark:border-yellow-700"
          aria-label={t('brainstorm.generateButton')}
        >
          <LightBulbIcon className={`w-4 h-4 ${isLoading ? 'animate-pulse' : ''}`} />
          {isLoading ? t('brainstorm.generating') : t('brainstorm.generateButton')}
        </button>
      </div>

      {/* Suggestion Display */}
      {currentSuggestion ? (
        <div className="space-y-3">
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/10 rounded-md border-l-4 border-yellow-400 dark:border-yellow-500">
            <p className="text-gray-800 dark:text-gray-200 leading-relaxed">
              {currentSuggestion.text}
            </p>
          </div>
          
          <div className="flex items-center justify-between text-xs">
            <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
              {t(`brainstorm.types.${currentSuggestion.type}`)}
            </span>
            
            <button
              onClick={handleGenerateSuggestion}
              disabled={isLoading}
              className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-700 dark:hover:text-yellow-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('brainstorm.newSuggestion')}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('brainstorm.clickToStart')}
          </p>
        </div>
      )}
    </div>
  );
} 