'use client';

import Link from "next/link";
import { logOut } from "@services/firebaseAuth.service";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@services/firebaseAuth.service";
import { ChevronIcon } from "@components/Icons";
import { useTranslation } from "react-i18next";
import i18n from "@locales/i18n";

export default function DashboardNav() {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [imgError, setImgError] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const languages = [
    { code: "en", flag: "🇺🇸", label: "English" },
    { code: "ru", flag: "🇷🇺", label: "Русский" },
    { code: "uk", flag: "🇺🇦", label: "Українська" }
  ];

  const getCookie = (name: string) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift()?.trim();
    return null;
  };

  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    if (typeof document !== 'undefined') {
      const lang = getCookie('lang');
      return lang ? lang : 'en';
    }
    return 'en';
  });
  const [showLangDropdown, setShowLangDropdown] = useState(false);

  const handleLocaleChange = (lang: string) => {
    if (lang === selectedLanguage) return;
    setSelectedLanguage(lang);
    setShowLangDropdown(false);
    document.cookie = `lang=${lang}; path=/`;
    i18n.changeLanguage(lang);
  };

  const handleLogout = async () => {
    try {
      await logOut();
      localStorage.removeItem('guestUser');
      sessionStorage.clear();
      window.location.href = '/';
    } catch (error) {
      console.error('Logout failed:', error);
      router.refresh();
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (!user) {
        router.push('/');
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    setImgError(false);
  }, [user?.photoURL]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.avatar-container')) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleClickOutsideLang = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.language-container')) {
        setShowLangDropdown(false);
      }
    };
    document.addEventListener('click', handleClickOutsideLang);
    return () => document.removeEventListener('click', handleClickOutsideLang);
  }, []);

  useEffect(() => {
    const lang = getCookie('lang') || 'en';
    if (lang !== selectedLanguage) {
      setSelectedLanguage(lang);
    }
  }, []);

  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <Link href="/dashboard" className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {t('dashboardNav.dashboard')}
          </Link>
          <div className="flex items-center gap-4">
            <div className="language-container relative">
              <button
                onClick={() => setShowLangDropdown(!showLangDropdown)}
                className="flex items-center gap-1 focus:outline-none"
              >
                <span className="text-xl">
                  {languages.find(lang => lang.code === selectedLanguage)?.flag}
                </span>
                <ChevronIcon className={`${showLangDropdown ? 'rotate-180' : ''}`} />
              </button>
              {showLangDropdown && (
                <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 rounded-md shadow-lg py-2 border border-gray-200 dark:border-gray-700">
                  {languages.filter(lang => lang.code !== selectedLanguage).map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => handleLocaleChange(lang.code)}
                      className="w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="avatar-container relative flex items-center gap-4">
              <button 
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 focus:outline-none"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center text-white">
                  {user?.photoURL && !imgError ? (
                    <img 
                      src={user.photoURL} 
                      alt="Avatar" 
                      className="w-full h-full rounded-full"
                      onError={() => setImgError(true)}
                    />
                  ) : (
                    <span>{user?.email?.[0]?.toUpperCase() || t('dashboardNav.guest')}</span>
                  )}
                </div>
                <ChevronIcon className={`${showDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showDropdown && (
                <div className="absolute right-0 top-14 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-2 border border-gray-200 dark:border-gray-700">
                  <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {user?.displayName || t('dashboardNav.guest')}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {user?.email || ''}
                    </p>
                  </div>
                  <Link
                    href="/settings"
                    className="block w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {t('dashboardNav.settings')}
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-2 text-sm text-left text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-700"
                  >
                    {t('dashboardNav.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
