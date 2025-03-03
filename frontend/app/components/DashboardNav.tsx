'use client';

import Link from "next/link";
import { logOut } from "@services/firebaseAuth.service";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@services/firebaseAuth.service";
import { ChevronIcon } from "@components/Icons";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@components/LanguageSwitcher";
import "@locales/i18n";

export default function DashboardNav() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [imgError, setImgError] = useState(false);
  const router = useRouter();
  const avatarRef = useRef<HTMLDivElement>(null);

  // Memoize the logout handler to prevent unnecessary re-renders
  const handleLogout = useCallback(async () => {
    try {
      const currentLang = document.cookie.match(/lang=([^;]+)/)?.[1] || 'en';
      
      await logOut();
      localStorage.removeItem('guestUser');
      sessionStorage.clear();

      await i18n.changeLanguage(currentLang);
      document.cookie = `lang=${currentLang}; path=/; max-age=2592000`;
      
      // Use router.push instead of direct window.location manipulation
      router.push('/');
    } catch (error) {
      console.error('Logout failed:', error);
      router.refresh();
    }
  }, [router, i18n]);

  // Auth state effect
  useEffect(() => {
    let isMounted = true;
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // Only update state if component is still mounted
      if (isMounted) {
        setUser(currentUser);
        if (!currentUser) {
          router.push('/');
        }
      }
    });
    
    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [router]);

  // Reset image error state when photo URL changes
  useEffect(() => {
    if (user?.photoURL) {
      setImgError(false);
    }
  }, [user?.photoURL]);

  // Handle clicks outside of dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    
    // Only add listener if dropdown is open
    if (showDropdown) {
      document.addEventListener('click', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showDropdown]);

  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <Link href="/dashboard" className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            <span suppressHydrationWarning={true}>
              {t('navigation.dashboard')}
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <div className="language-container">
              <LanguageSwitcher />
            </div>
            <div ref={avatarRef} className="avatar-container relative flex items-center gap-4">
              <button 
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 focus:outline-none"
                data-testid="avatar-button"
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
                    <span suppressHydrationWarning={true}>
                      {typeof window !== 'undefined' 
                        ? (user?.email?.[0]?.toUpperCase() || t('navigation.guest')[0])
                        : 'G' // Always show English letter on server
                      }
                    </span>
                  )}
                </div>
                <ChevronIcon className={`${showDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showDropdown && (
                <div className="absolute right-0 top-14 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-2 border border-gray-200 dark:border-gray-700 z-50">
                  <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      <span suppressHydrationWarning={true}>
                        {user?.displayName || t('navigation.guest')}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {user?.email || ''}
                    </p>
                  </div>
                  <Link
                    href="/settings"
                    className="block w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <span suppressHydrationWarning={true}>
                      {t('navigation.settings')}
                    </span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-2 text-sm text-left text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-700"
                  >
                    <span suppressHydrationWarning={true}>
                      {t('navigation.logout')}
                    </span>
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
