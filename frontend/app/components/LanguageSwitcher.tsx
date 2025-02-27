import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { updateUserLanguage } from '@/services/userSettings.service';
import useAuth from '@/hooks/useAuth';

// List of supported languages
const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
];

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  const currentLang = SUPPORTED_LANGUAGES.find((lang) => 
    lang.code === i18n.language
  ) || SUPPORTED_LANGUAGES[0];

  const toggleDropdown = () => {
    setOpen((prev) => !prev);
  };

  const changeLanguage = async (lang: string) => {
    try {
      // Update language in i18n
      i18n.changeLanguage(lang);
      
      // Update language in DB or cookie via service
      await updateUserLanguage(user?.uid || '', lang);
      
      setOpen(false);
    } catch (error) {
      console.error('Failed to update language preference:', error);
      // UI is already updated via i18n, so no need for explicit fallback
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        onClick={toggleDropdown}
        className="inline-flex items-center justify-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Change language"
      >
        <span className="mr-2">🌐</span> <span suppressHydrationWarning={true}>{currentLang.name}</span>
        <svg
          className="ml-2 h-5 w-5 text-gray-500"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="origin-top-right absolute right-0 mt-2 w-40 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-10">
          <div className="py-1">
            {SUPPORTED_LANGUAGES
              .filter((lang) => lang.code !== i18n.language)
              .map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => changeLanguage(lang.code)}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <span suppressHydrationWarning={true}>{lang.name}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
} 