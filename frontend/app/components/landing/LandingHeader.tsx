'use client';
import React from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '@/components/navigation/LanguageSwitcher'; 
import '@locales/i18n';

const LandingHeader = () => {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-center items-center py-4 relative">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent text-center">
          <span suppressHydrationWarning={true}>
            {t('landing.title')}
          </span>
        </h1>
        <div className="absolute right-4">
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
};

export default LandingHeader; 