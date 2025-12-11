'use client';
import React from 'react';
import { useTranslation } from 'react-i18next';

const LandingFooter = () => {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-slate-200/70 bg-white/80 py-6 text-slate-500 backdrop-blur dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-400">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 text-sm sm:px-6 lg:px-8">
        <span className="font-medium text-left text-slate-600 dark:text-slate-300">
          &copy; 2024 - {new Date().getFullYear()} Preacher Helper
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          <span suppressHydrationWarning={true}>{t('landing.footerTagline')}</span>
        </span>
      </div>
    </footer>
  );
};

export default LandingFooter; 