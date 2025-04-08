import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { updateUserLanguage } from '@/services/userSettings.service';
import { useAuth } from '@/hooks/useAuth';

// List of supported languages
const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
];

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  const currentLang = SUPPORTED_LANGUAGES.find((lang) => 
    lang.code === (i18n?.language || 'en')
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
        className="flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Change language"
        title={currentLang.name}
      >
        <span className="text-lg">🌐</span>
      </button>
      {open && (
        <div className="origin-top-right absolute right-0 mt-2 w-40 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-10">
          <div className="py-1">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => changeLanguage(lang.code)}
                className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between 
                  ${lang.code === i18n.language 
                    ? 'bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 font-medium' 
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
              >
                <span suppressHydrationWarning={true}>{lang.name}</span>
                
                {lang.code === i18n.language && (
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    className="h-4 w-4 ml-2 text-blue-600 dark:text-blue-300" 
                    viewBox="0 0 20 20" 
                    fill="currentColor"
                  >
                    <path 
                      fillRule="evenodd" 
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" 
                      clipRule="evenodd" 
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
} 