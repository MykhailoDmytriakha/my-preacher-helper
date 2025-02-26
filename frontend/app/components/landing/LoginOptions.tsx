"use client";

import React from 'react';
import { GoogleIcon, UserIcon } from '@components/Icons';
import { useTranslation } from 'react-i18next';

interface LoginOptionsProps {
  onGoogleLogin: () => void;
  onGuestLogin: () => void;
  onTestLogin: () => void;
}

export default function LoginOptions({ onGoogleLogin, onGuestLogin, onTestLogin }: LoginOptionsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 items-center p-8 rounded-2xl bg-white dark:bg-gray-800 shadow-lg w-full max-w-md border dark:border-gray-700">
      <div className="text-center space-y-2 w-full">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          <span suppressHydrationWarning={true}>
            {t('loginOptions.heading')}
          </span>
        </h2>
      </div>

      <div className="w-full space-y-3">
        <button
          className="w-full px-6 py-3 bg-gradient-to-r from-blue-200 to-green-200 rounded-lg hover:from-blue-700 hover:to-green-700 transition-all flex items-center justify-center gap-2"
          onClick={onGoogleLogin}
        >
          <GoogleIcon className="w-5 h-5" />
          <span suppressHydrationWarning={true}>
            {t('loginOptions.googleLogin')}
          </span>
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white dark:bg-gray-800 text-gray-500" suppressHydrationWarning={true}>
              {t('loginOptions.or')}
            </span>
          </div>
        </div>

        <button
          className="w-full px-6 py-3 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-all flex items-center justify-center gap-2"
          onClick={onGuestLogin}
        >
          <UserIcon className="w-5 h-5" />
          <span suppressHydrationWarning={true}>
            {t('loginOptions.guestLogin')}
          </span>
        </button>

        {process.env.NODE_ENV === 'development' && (
          <button
            className="w-full px-6 py-3 bg-yellow-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-yellow-400 dark:border-yellow-600 rounded-lg hover:bg-yellow-100 dark:hover:bg-gray-700 transition-all flex items-center justify-center gap-2"
            onClick={onTestLogin}
          >
            <span suppressHydrationWarning={true}>
              {t('loginOptions.testLogin')}
            </span>
          </button>
        )}
      </div>
    </div>
  );
} 