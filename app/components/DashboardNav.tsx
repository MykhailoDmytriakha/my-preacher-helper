'use client';

import Link from "next/link";
import { logOut } from "@services/firebaseAuth.service";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@services/firebaseAuth.service";
import { ChevronIcon } from "@components/Icons";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@components/LanguageSwitcher";

export default function DashboardNav() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [imgError, setImgError] = useState(false);
  const router = useRouter();

  const normalizeLang = (lang: string | null | undefined): string => {
    if (!lang) return 'en';
    return lang;
  };

  const getCookie = (name: string): string | null => {
    const cookies = document.cookie.split('; ');
    for (let cookie of cookies) {
      const [cookieName, cookieValue] = cookie.split('=');
      if (cookieName === name) return cookieValue;
    }
    return null;
  };


  const handleLogout = async () => {
    try {
      const currentLang = document.cookie.match(/lang=([^;]+)/)?.[1] || 'en';
      
      await logOut();
      localStorage.removeItem('guestUser');
      sessionStorage.clear();

      await i18n.changeLanguage(currentLang);
      document.cookie = `lang=${currentLang}; path=/; max-age=2592000`;
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

  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <Link href="/dashboard" className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {t('dashboardNav.dashboard')}
          </Link>
          <div className="flex items-center gap-4">
            <div className="language-container">
              <LanguageSwitcher />
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
                    <span>{user?.email?.[0]?.toUpperCase() || t('dashboardNav.guest')[0]}</span>
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
