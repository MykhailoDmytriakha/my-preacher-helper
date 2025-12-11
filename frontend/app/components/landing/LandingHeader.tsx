'use client';
import React from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '@/components/navigation/LanguageSwitcher'; 
import '@locales/i18n';

const LandingHeader = () => {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/70 backdrop-blur-xl shadow-sm shadow-blue-50 transition dark:border-white/10 dark:bg-slate-950/50 dark:shadow-none">
      <div className="relative mx-auto flex max-w-7xl items-center justify-center px-4 py-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl dark:text-white">
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