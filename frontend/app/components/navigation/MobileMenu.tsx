'use client';

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { ArrowRightOnRectangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { User } from "firebase/auth";
import Link from "next/link";
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from "react-i18next";

import LanguageSwitcher from "@/components/navigation/LanguageSwitcher";
import { primaryNavItems, isNavItemActive } from '@/components/navigation/navConfig';
import ThemeModeToggle from "@/components/navigation/ThemeModeToggle";
import UserAvatar from "@/components/navigation/UserAvatar";
import { getNavItemTheme } from '@/utils/themeColors';
import "@locales/i18n";

interface MobileMenuProps {
  isOpen: boolean;
  onLogout: () => Promise<void>;
  pathname?: string | null;
  onNavigate?: () => void;
  onClose?: () => void;
  /** Who is signed in. The phone bar has no room for an avatar, so this row carries it. */
  user?: User | null;
}

export default function MobileMenu({ isOpen, onLogout, pathname, onNavigate, onClose, user = null }: MobileMenuProps) {
  const { t } = useTranslation();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const close = () => (onClose ?? onNavigate)?.();
  const closeRef = useRef(close);
  closeRef.current = close;
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const visual = window.visualViewport;
    const updateViewport = () => {
      if (window.innerWidth >= 1024) {
        closeRef.current();
        return;
      }
      setViewport({
        height: visual?.height ?? window.innerHeight,
        top: visual?.offsetTop ?? 0,
      });
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    visual?.addEventListener('resize', updateViewport);
    visual?.addEventListener('scroll', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      visual?.removeEventListener('resize', updateViewport);
      visual?.removeEventListener('scroll', updateViewport);
    };
  }, [isOpen]);

  // Signing in with an email leaves `displayName` empty, and that is the common case here,
  // so the email takes the top line rather than the row claiming a "Guest" over a real
  // account. The second line only exists when there is something else to say.
  const accountName = user?.displayName || user?.email || t('navigation.guest');
  const accountEmail = user?.displayName ? user.email : null;

  const navItems = primaryNavItems
    .map((item) => ({
      ...item,
      label: t(item.labelKey, { defaultValue: item.defaultLabel })
    }));

  return (
    <Dialog open={isOpen} onClose={close} initialFocus={closeButtonRef} className="fixed inset-0 z-[90]">
      <DialogBackdrop className="fixed inset-0 bg-gray-950/40 backdrop-blur-sm" />
      <div className="fixed inset-x-0 top-0 flex justify-end p-3" style={{ top: viewport?.top ?? 0 }}>
        <DialogPanel
          className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
          style={{ maxHeight: viewport ? Math.max(160, viewport.height - 24) : undefined, paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
            <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('navigation.menu', { defaultValue: 'Menu' })}</DialogTitle>
            <button ref={closeButtonRef} type="button" onClick={close} aria-label={t('common.close')}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-gray-300 dark:hover:bg-gray-800">
              <XMarkIcon className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
            <div className="space-y-1 py-2">
              {navItems.map((item) => {
                const active = isNavItemActive(pathname || null, item.matchers);
                const Icon = item.icon;
                const themeClasses = getNavItemTheme(item.theme);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    prefetch
                    onClick={() => { onNavigate?.(); onClose?.(); }}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-h-12 items-center justify-between rounded-md px-3 py-2 text-base font-medium transition ${active
                      ? themeClasses.menu
                      : `text-gray-700 dark:text-gray-300 ${themeClasses.hover}`
                      }`}
                  >
                    <span className="flex items-center gap-2" suppressHydrationWarning={true}>
                      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                      {item.label}
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
            <div className="space-y-3 border-t border-gray-200 px-1 py-4 dark:border-gray-700">
              <LanguageSwitcher variant="menu" />
              <ThemeModeToggle variant="menu" />
            </div>
            <div className="border-t border-gray-200 px-1 py-4 dark:border-gray-700">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar user={user} />
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-gray-900 dark:text-gray-100">
                    <span suppressHydrationWarning={true}>{accountName}</span>
                  </p>
                  {accountEmail && (
                    <p className="break-all text-xs leading-tight text-gray-500 dark:text-gray-400">
                      {accountEmail}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-base font-medium text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-700"
            >
              <ArrowRightOnRectangleIcon className="h-5 w-5" aria-hidden="true" />
              <span suppressHydrationWarning={true}>
                {t('navigation.logout_account', { defaultValue: 'Sign out' })}
              </span>
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
