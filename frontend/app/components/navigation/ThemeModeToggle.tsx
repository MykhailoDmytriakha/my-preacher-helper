'use client';

import { ComputerDesktopIcon, MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { useTranslation } from 'react-i18next';

import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference';
import '@locales/i18n';

type ThemeIcon = ComponentType<SVGProps<SVGSVGElement>>;

type ThemeModeToggleVariant = 'full' | 'compact';

type ThemeOptionDef = {
  value: ThemePreference;
  icon: ThemeIcon;
  labelKey: string;
  defaultLabel: string;
  gradient: string;
  textClass: string;
};

interface ThemeModeToggleProps {
  variant?: ThemeModeToggleVariant;
  className?: string;
}

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

export default function ThemeModeToggle({ variant = 'full', className = '' }: ThemeModeToggleProps) {
  const { t } = useTranslation();
  const { preference, setPreference } = useThemePreference();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const appearanceLabel = mounted
    ? t('settings.appearance.themeMode', { defaultValue: 'Theme mode' })
    : 'Theme mode';
  const themeOptions = THEME_OPTION_DEFINITIONS.map((option) => ({
    ...option,
    label: mounted ? t(option.labelKey, { defaultValue: option.defaultLabel }) : option.defaultLabel,
  }));
  const currentThemeLabel = themeOptions.find((option) => option.value === preference)?.label
    ?? themeOptions[1]?.label
    ?? themeOptions[0].label;

  const isCompact = variant === 'compact';
  const containerClassName = isCompact
    ? `flex items-center ${className}`.trim()
    : `px-4 py-3 space-y-2 border-b border-gray-200 dark:border-gray-700 ${className}`.trim();
  const toggleRowClassName = [
    'flex items-stretch overflow-hidden rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 divide-x divide-gray-200 dark:divide-gray-700',
    isCompact ? 'h-9 w-auto' : 'h-10 w-full',
  ].join(' ');

  return (
    <div className={containerClassName} role={isCompact ? 'group' : undefined} aria-label={isCompact ? appearanceLabel : undefined}>
      {!isCompact && (
        <div className="flex flex-col items-center gap-0.5 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-gray-500 dark:text-gray-400">
            <span suppressHydrationWarning={true}>{appearanceLabel}</span>
          </p>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            <span suppressHydrationWarning={true}>{currentThemeLabel}</span>
          </p>
        </div>
      )}
      <div className={toggleRowClassName}>
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
  );
}
