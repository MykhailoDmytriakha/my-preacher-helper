'use client';

import Link from "next/link";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/components/navigation/LanguageSwitcher";
import "@locales/i18n";
import { primaryNavItems, isNavItemActive } from '@/components/navigation/navConfig';

interface MobileMenuProps {
  isOpen: boolean;
  onLogout: () => Promise<void>;
  pathname?: string | null;
  onNavigate?: () => void;
}

export default function MobileMenu({ isOpen, onLogout, pathname, onNavigate }: MobileMenuProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const navItems = primaryNavItems.map((item) => ({
    ...item,
    label: t(item.labelKey, { defaultValue: item.defaultLabel })
  }));

  return (
    <div className="md:hidden">
      <div className="px-2 pt-2 pb-3 space-y-1 border-t border-gray-200 dark:border-gray-700">
        <div className="flex justify-center py-2">
          <LanguageSwitcher />
        </div>
        <div className="space-y-1">
          {navItems.map((item) => {
            const active = isNavItemActive(pathname || null, item.matchers);
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                prefetch
                onClick={() => onNavigate?.()}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-base font-medium transition ${
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                <span className="flex items-center gap-2" suppressHydrationWarning={true}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {item.label}
                </span>
                {active && (
                  <span className="text-xs text-blue-600 dark:text-blue-300" aria-hidden="true">
                    •
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <button
          onClick={onLogout}
          className="w-full px-3 py-2 rounded-md text-base font-medium text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-700 text-center"
        >
          <span suppressHydrationWarning={true}>
            {t('navigation.logout')}
          </span>
        </button>
      </div>
    </div>
  );
} 
