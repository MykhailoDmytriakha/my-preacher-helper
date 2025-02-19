"use client";

import React from 'react';
import { GoogleIcon, UserIcon } from '@components/Icons';

interface LoginOptionsProps {
  onGoogleLogin: () => void;
  onGuestLogin: () => void;
  onTestLogin: () => void;
}

export default function LoginOptions({ onGoogleLogin, onGuestLogin, onTestLogin }: LoginOptionsProps) {
  return (
    <div className="flex flex-col gap-4 items-center p-8 rounded-2xl bg-white dark:bg-gray-800 shadow-lg w-full max-w-md border dark:border-gray-700">
      <div className="text-center space-y-2 w-full">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Начните использовать
        </h2>
      </div>

      <div className="w-full space-y-3">
        <button
          className="w-full px-6 py-3 bg-gradient-to-r from-blue-200 to-green-200 rounded-lg hover:from-blue-700 hover:to-green-700 transition-all flex items-center justify-center gap-2"
          onClick={onGoogleLogin}
        >
          <GoogleIcon className="w-5 h-5" />
          Войти через Google
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white dark:bg-gray-800 text-gray-500">или</span>
          </div>
        </div>

        <button
          className="w-full px-6 py-3 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-all flex items-center justify-center gap-2"
          onClick={onGuestLogin}
        >
          <UserIcon className="w-5 h-5" />
          Продолжить как гость
        </button>

        {process.env.NODE_ENV === 'development' && (
          <button
            className="w-full px-6 py-3 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-lg hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-all flex items-center justify-center gap-2"
            onClick={onTestLogin}
          >
            <UserIcon className="w-5 h-5" />
            Войти как тестовый пользователь
          </button>
        )}
      </div>
    </div>
  );
} 