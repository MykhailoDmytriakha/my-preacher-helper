'use client';

import { ComputerDesktopIcon, MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import { User } from "firebase/auth";
import Image from "next/image";
import { useState, useRef, useEffect, type ComponentType, type SVGProps } from "react";
import { useTranslation } from "react-i18next";

import { useThemePreference, type ThemePreference } from "@/hooks/useThemePreference";
import { ChevronIcon } from "@components/Icons";
import "@locales/i18n";

type ThemeIcon = ComponentType<SVGProps<SVGSVGElement>>;

type ThemeOptionDef = {
  value: ThemePreference;
  icon: ThemeIcon;
  labelKey: string;
  defaultLabel: string;
  gradient: string;
  textClass: string;
};

const THEME_OPTION_DEFINITIONS: ThemeOptionDef[] = [
  {
    value: 'dark',
    icon: MoonIcon,
    labelKey: 'settings.appearance.dark',
    defaultLabel: 'Dark',
    gradient: 'from-slate-900/90 to-slate-700/90',
    textClass: 'text-white shadow-inner',
  },
  {
    value: 'system',
    icon: ComputerDesktopIcon,
    labelKey: 'settings.appearance.system',
    defaultLabel: 'System',
    gradient: 'from-slate-500/90 via-slate-600/90 to-slate-500/90',
    textClass: 'text-white shadow-inner',
  },
  {
    value: 'light',
    icon: SunIcon,
    labelKey: 'settings.appearance.light',
    defaultLabel: 'Light',
    gradient: 'from-amber-400/90 via-amber-300/80 to-yellow-300/90',
    textClass: 'text-amber-950 dark:text-amber-100 shadow-inner',
  },
];

interface UserProfileDropdownProps {
  user: User | null;
  onLogout: () => Promise<void>;
}

export default function UserProfileDropdown({ user, onLogout }: UserProfileDropdownProps) {
  const { t } = useTranslation();
  const { preference, setPreference } = useThemePreference();
  const appearanceLabel = t('settings.appearance.themeMode', { defaultValue: 'Theme mode' });
  const themeOptions = THEME_OPTION_DEFINITIONS.map((option) => ({
    ...option,
    label: t(option.labelKey, { defaultValue: option.defaultLabel }),
  }));
  const currentThemeLabel = themeOptions.find((option) => option.value === preference)?.label
    ?? themeOptions[1]?.label
    ?? themeOptions[0].label;
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
          <div className="px-4 py-3 space-y-2 border-b border-gray-200 dark:border-gray-700">
            <div className="flex flex-col items-center gap-0.5 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-gray-500 dark:text-gray-400">
                {appearanceLabel}
              </p>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {currentThemeLabel}
              </p>
            </div>
            <div className="flex h-10 w-full items-stretch overflow-hidden rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 divide-x divide-gray-200 dark:divide-gray-700">
              {themeOptions.map((option) => {
                const isActive = preference === option.value;
                const Icon = option.icon;
                const baseClasses =
                  'flex flex-1 items-center justify-center px-2 h-full text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900';
                const activeClasses = `bg-gradient-to-r ${option.gradient} ${option.textClass}`;
                const inactiveClasses = 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800';

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={option.label}
                    title={option.label}
                    aria-pressed={isActive}
                    onClick={() => setPreference(option.value)}
                    className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
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
