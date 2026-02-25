'use client';

import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import Link from "next/link";
import { useTranslation } from "react-i18next";

import LanguageSwitcher from "@/components/navigation/LanguageSwitcher";
import { primaryNavItems, isNavItemActive } from '@/components/navigation/navConfig';
import ThemeModeToggle from "@/components/navigation/ThemeModeToggle";
import { getNavItemTheme } from '@/utils/themeColors';
import "@locales/i18n";

interface MobileMenuProps {
  isOpen: boolean;
  onLogout: () => Promise<void>;
  pathname?: string | null;
  showGroups?: boolean;
  onNavigate?: () => void;
}

export default function MobileMenu({ isOpen, onLogout, pathname, showGroups = true, onNavigate }: MobileMenuProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const navItems = primaryNavItems
    .filter((item) => showGroups || item.key !== 'groups')
    .map((item) => ({
      ...item,
      label: t(item.labelKey, { defaultValue: item.defaultLabel })
    }));

  return (
    <div className="lg:hidden">
      <div className="px-2 pt-2 pb-3 space-y-1 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-center gap-4 py-3">
          <ThemeModeToggle variant="compact" />
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700"></div>
          <LanguageSwitcher />
        </div>
        <div className="space-y-1">
          {navItems.map((item) => {
            const active = isNavItemActive(pathname || null, item.matchers);
            const Icon = item.icon;
            const themeClasses = getNavItemTheme(item.theme);
            return (
              <Link
                key={item.key}
                href={item.href}
                prefetch
                onClick={() => onNavigate?.()}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-base font-medium transition ${active
                  ? themeClasses.menu
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
              >
                <span className="flex items-center gap-2" suppressHydrationWarning={true}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {item.label}
                  {item.isBeta && (
                    <span className="text-[10px] uppercase font-bold px-1 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 rounded leading-tight">
                      Beta
                    </span>
                  )}
                </span>
                {active && (
                  <span className={`text-xs ${themeClasses.indicator}`} aria-hidden="true">
                    •
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <button
          onClick={onLogout}
          className="w-full px-3 py-2 rounded-md text-base font-medium text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-700 flex items-center justify-center gap-2"
        >
          <ArrowRightOnRectangleIcon className="h-5 w-5" aria-hidden="true" />
          <span suppressHydrationWarning={true}>
            {t('navigation.logout_account', { defaultValue: 'Выйти из аккаунта' })}
          </span>
        </button>
      </div>
    </div>
  );
} 
