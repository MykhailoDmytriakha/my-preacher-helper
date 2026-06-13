"use client";

import { GoogleLogin } from '@react-oauth/google';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CheckIcon, GoogleIcon } from '@components/Icons';

interface LoginOptionsProps {
  onGoogleLogin: () => void;
  onTestLogin: () => void;
  googleLoading?: boolean;
  testLoading?: boolean;
  /**
   * When provided, render Google's own FedCM button (inline account dropdown,
   * no popup window). `onGoogleCredential` receives the Google ID token to hand
   * to Firebase via signInWithCredential. Without these props we fall back to
   * the custom popup button (`onGoogleLogin`).
   */
  googleClientId?: string;
  onGoogleCredential?: (credential: string) => void;
}

export default function LoginOptions({
  onGoogleLogin,
  onTestLogin,
  googleLoading = false,
  testLoading = false,
  googleClientId,
  onGoogleCredential,
}: LoginOptionsProps) {
  const { t } = useTranslation();
  const isDev = process.env.NODE_ENV === 'development';
  const isLoading = googleLoading || testLoading;
  const useFedcmButton = Boolean(googleClientId && onGoogleCredential);

  // Google's button is its own iframe — we can't CSS it, but we can pick the
  // theme that matches the app. Track the app's dark class so the button renders
  // dark-on-dark (filled_black) instead of a white card on the dark background.
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const sync = () => setIsDark(document.documentElement.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="flex w-full max-w-md flex-col flex-wrap rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-lg shadow-blue-100 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-none">
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
        <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-50 px-3 py-1 text-center text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
          <span suppressHydrationWarning={true}>{t('loginOptions.secureBadge')}</span>
        </span>
      </div>

      <div className="mt-5 grid w-full gap-3">
        {useFedcmButton ? (
          // Google's own button: clicking opens the browser-native FedCM account
          // dropdown inline (no popup window, no redirect). onSuccess returns the
          // Google ID token, handed to Firebase via signInWithCredential upstream.
          <div className="flex w-full justify-center overflow-hidden rounded-full">
            <GoogleLogin
              key={isDark ? 'dark' : 'light'}
              onSuccess={(response) => {
                if (response.credential) onGoogleCredential!(response.credential);
              }}
              onError={() => {
                console.error('Google sign-in failed');
              }}
              use_fedcm_for_button
              theme={isDark ? 'filled_black' : 'outline'}
              size="large"
              text="signin_with"
              shape="pill"
              width="400"
            />
          </div>
        ) : (
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
        )}

        {isDev && (
          <button
            className="flex w-full items-center justify-center gap-2 rounded-full border border-amber-400 bg-amber-100/50 px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-amber-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:cursor-not-allowed disabled:opacity-75 dark:border-amber-300/80 dark:bg-amber-500/15 dark:text-white dark:hover:border-amber-300 dark:hover:bg-amber-500/25"
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
