import React from 'react';
import { useTranslation } from 'react-i18next';

export default function FeatureCards() {
  const { t } = useTranslation();
  return (
    <div className="grid md:grid-cols-3 gap-8 w-full max-w-4xl mb-16">
      <div className="p-8 border rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all dark:border-gray-700 group">
        <div className="space-y-4">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-blue-600 to-blue-400 flex items-center justify-center text-2xl text-white">
            🎙️
          </div>
          <h3 className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {t('featureCards.recordingTitle')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {t('featureCards.recordingDescription')}
          </p>
        </div>
      </div>
      <div className="p-8 border rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all dark:border-gray-700 group">
        <div className="space-y-4">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-purple-600 to-pink-500 flex items-center justify-center text-2xl text-white">
            ✨
          </div>
          <h3 className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {t('featureCards.structuringTitle')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {t('featureCards.structuringDescription')}
          </p>
        </div>
      </div>
      <div className="p-8 border rounded-xl bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-all dark:border-gray-700 group">
        <div className="space-y-4">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-green-600 to-cyan-500 flex items-center justify-center text-2xl text-white">
            🏷️
          </div>
          <h3 className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {t('featureCards.analysisTitle')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {t('featureCards.analysisDescription')}
          </p>
        </div>
      </div>
    </div>
  );
} 