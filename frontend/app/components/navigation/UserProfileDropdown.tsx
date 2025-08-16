'use client';

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { User } from "firebase/auth";
import { useTranslation } from "react-i18next";
import { ChevronIcon } from "@components/Icons";
import "@locales/i18n";
import Image from "next/image";

interface UserProfileDropdownProps {
  user: User | null;
  onLogout: () => Promise<void>;
}

export default function UserProfileDropdown({ user, onLogout }: UserProfileDropdownProps) {
  const { t } = useTranslation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [imgError, setImgError] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

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
    <div ref={avatarRef} className="avatar-container relative flex items-center gap-4">
      <button 
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 focus:outline-none"
        data-testid="avatar-button"
      >
        <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center text-white">
          {user?.photoURL && !imgError ? (
            <Image 
              src={user.photoURL} 
              alt="Avatar" 
              width={40}
              height={40}
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
        <ChevronIcon className={`hidden sm:block ${showDropdown ? 'rotate-180' : ''}`} />
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
            onClick={onLogout}
            className="w-full px-4 py-2 text-sm text-left text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-700"
          >
            <span suppressHydrationWarning={true}>
              {t('navigation.logout')}
            </span>
          </button>
        </div>
      )}
    </div>
  );
} 