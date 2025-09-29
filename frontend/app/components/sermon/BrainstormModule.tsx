"use client";

import { useState } from 'react';
import { LightBulbIcon } from '@components/Icons';
import { BrainstormSuggestion } from '@/models/models';
import { generateBrainstormSuggestion } from '@/services/brainstorm.service';
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardIcon, SparklesIcon } from '@heroicons/react/24/outline';

interface BrainstormModuleProps {
  sermonId: string;
  className?: string;
  currentSuggestion?: BrainstormSuggestion | null;
  onSuggestionChange?: (suggestion: BrainstormSuggestion | null) => void;
}

export default function BrainstormModule({ 
  sermonId, 
  className = "",
  currentSuggestion: externalSuggestion,
  onSuggestionChange 
}: BrainstormModuleProps) {
  const [internalSuggestion, setInternalSuggestion] = useState<BrainstormSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  // Use external state if provided, otherwise use internal state
  const currentSuggestion = externalSuggestion !== undefined ? externalSuggestion : internalSuggestion;
  const setCurrentSuggestion = onSuggestionChange || setInternalSuggestion;

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

  const getTypeIcon = (type: string) => {
    const isQuestion = type === 'question' || type === 'QUESTION';
    return isQuestion ? '?' : '💡';
  };

  return (
    <div className={`relative ${className}`}>
      <AnimatePresence mode="wait">
        {!currentSuggestion ? (
          <motion.button
            key="trigger"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={handleGenerateSuggestion}
            disabled={isLoading}
            aria-label={t('brainstorm.generateButton')}
            className="w-full group relative overflow-hidden bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-gray-800 dark:to-gray-800 border-2 border-dashed border-amber-300 dark:border-amber-700 rounded-xl p-5 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 dark:from-amber-600 dark:to-yellow-700 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                {isLoading ? (
                  <SparklesIcon className="w-6 h-6 text-white animate-spin" />
                ) : (
                  <LightBulbIcon className="w-6 h-6 text-white" />
                )}
              </div>
              <div className="flex-1 text-left">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  {isLoading ? t('brainstorm.generating') : t('brainstorm.title')}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('brainstorm.subtitle')}
                </p>
              </div>
              {!isLoading && (
                <div className="flex-shrink-0">
                  <div className="px-4 py-2 bg-amber-400 dark:bg-amber-600 text-white rounded-lg font-medium text-sm shadow group-hover:bg-amber-500 dark:group-hover:bg-amber-700 transition-colors">
                    {t('brainstorm.generateButton')}
                  </div>
                </div>
              )}
            </div>
            
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
          </motion.button>
        ) : (
          <motion.div
            key="suggestion"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="relative bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-amber-400 to-yellow-500" />
            
            <div className="p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-amber-100 to-yellow-100 dark:from-amber-900/30 dark:to-yellow-900/30 flex items-center justify-center text-2xl">
                  {getTypeIcon(currentSuggestion.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                      {t(`brainstorm.types.${currentSuggestion.type}`)}
                    </span>
                  </div>
                  <p className="text-base leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                    {currentSuggestion.text}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopySuggestion}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-all"
                    aria-label={t('brainstorm.copySuggestion')}
                  >
                    <ClipboardIcon className="w-4 h-4" />
                    <span>{copied ? t('brainstorm.copied') : t('brainstorm.copy')}</span>
                  </button>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentSuggestion(null)}
                    className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all"
                  >
                    {t('actions.close')}
                  </button>
                  <button
                    onClick={handleGenerateSuggestion}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <>
                        <SparklesIcon className="w-4 h-4 animate-spin" />
                        <span>{t('brainstorm.generating')}</span>
                      </>
                    ) : (
                      <>
                        <SparklesIcon className="w-4 h-4" />
                        <span>{t('brainstorm.newSuggestion')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}