"use client";

import { useState } from 'react';
import { LightBulbIcon } from '@components/Icons';
import { BrainstormSuggestion } from '@/models/models';
import { generateBrainstormSuggestion } from '@/services/brainstorm.service';
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardIcon } from '@heroicons/react/24/outline';

interface BrainstormModuleProps {
  sermonId: string;
  className?: string;
}

export default function BrainstormModule({ sermonId, className = "" }: BrainstormModuleProps) {
  const [currentSuggestion, setCurrentSuggestion] = useState<BrainstormSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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

  return (
    <div className={`p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 transition-shadow hover:shadow-md ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <LightBulbIcon className="w-6 h-6 text-yellow-500 dark:text-yellow-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('brainstorm.title')}
          </h3>
        </div>
        
        <button
          onClick={handleGenerateSuggestion}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-yellow-200 dark:border-yellow-700 shadow-sm hover:shadow"
          aria-label={currentSuggestion ? t('brainstorm.generateAnother') : t('brainstorm.generateButton')}
        >
          <LightBulbIcon className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading
            ? t('brainstorm.generating')
            : currentSuggestion
              ? t('brainstorm.generateAnother')
              : t('brainstorm.generateButton')}
        </button>
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
              <span className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full text-sm font-medium">
                {t(`brainstorm.types.${currentSuggestion.type}`)}
              </span>
              
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
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="text-center py-6"
          >
            <LightBulbIcon className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-base text-gray-500 dark:text-gray-400">
              {t('brainstorm.clickToStart')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}