"use client";

import React from 'react';
import { useTranslation } from 'react-i18next';

import { CheckIcon, GoogleIcon } from '@components/Icons';

interface LoginOptionsProps {
  onGoogleLogin: () => void;
  onTestLogin: () => void;
  googleLoading?: boolean;
  testLoading?: boolean;
}

export default function LoginOptions({
  onGoogleLogin,
  onTestLogin,
  googleLoading = false,
  testLoading = false,
}: LoginOptionsProps) {
  const { t } = useTranslation();
  const isDev = process.env.NODE_ENV === 'development';
  const isLoading = googleLoading || testLoading;
  return (
    <div className="flex w-full max-w-xl flex-col flex-wrap rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-lg shadow-blue-100 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          <span suppressHydrationWarning={true}>
            {t('loginOptions.heading')}
          </span>
        </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <span suppressHydrationWarning={true}>
              {t('loginOptions.subheading')}
            </span>
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-center text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
          <span suppressHydrationWarning={true}>{t('loginOptions.secureBadge')}</span>
        </span>
      </div>

      <div className="mt-5 grid w-full gap-3">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-blue-200 transition hover:from-blue-700 hover:to-purple-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-75"
          onClick={onGoogleLogin}
          disabled={isLoading}
        >
          {googleLoading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <GoogleIcon className="h-5 w-5" />
          )}
          <span suppressHydrationWarning={true}>
            {googleLoading ? t('common.loading', { defaultValue: 'Loading...' }) : t('loginOptions.googleLogin')}
          </span>
        </button>

        {isDev && (
          <button
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400 bg-amber-100/50 px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-amber-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:opacity-75 dark:border-amber-300/80 dark:bg-amber-500/15 dark:text-white dark:hover:border-amber-300 dark:hover:bg-amber-500/25"
            onClick={onTestLogin}
            disabled={isLoading}
          >
            {testLoading && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400/40 border-t-slate-700 dark:border-white/25 dark:border-t-white" />
            )}
            <span suppressHydrationWarning={true}>
              {testLoading ? t('common.loading', { defaultValue: 'Loading...' }) : t('loginOptions.testLogin')}
            </span>
          </button>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
        <CheckIcon className="h-4 w-4 text-emerald-500 dark:text-emerald-300" />
        <span suppressHydrationWarning={true}>{t('loginOptions.note')}</span>
      </div>
    </div>
  );
} 
