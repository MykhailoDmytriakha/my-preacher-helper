'use client';

import Link from "next/link";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/components/navigation/LanguageSwitcher";
import "@locales/i18n";

interface MobileMenuProps {
  isOpen: boolean;
  onLogout: () => Promise<void>;
}

export default function MobileMenu({ isOpen, onLogout }: MobileMenuProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="md:hidden">
      <div className="px-2 pt-2 pb-3 space-y-1 border-t border-gray-200 dark:border-gray-700">
        <div className="flex justify-center py-2">
          <LanguageSwitcher />
        </div>
        <Link
          href="/settings"
          className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 text-center"
        >
          <span suppressHydrationWarning={true}>
            {t('navigation.settings')}
          </span>
        </Link>
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