'use client';

import { BookOpenIcon, ChatBubbleLeftEllipsisIcon } from '@heroicons/react/24/solid';
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

import FeedbackModal from "@/components/navigation/FeedbackModal";
import LanguageSwitcher from "@/components/navigation/LanguageSwitcher";
import MobileMenu from "@/components/navigation/MobileMenu";
import { primaryNavItems, isNavItemActive } from "@/components/navigation/navConfig";
import UserProfileDropdown from "@/components/navigation/UserProfileDropdown";
import { useAuth } from "@/hooks/useAuth";
import { useFeedback } from "@/hooks/useFeedback";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePrepModeAccess } from "@/hooks/usePrepModeAccess";
import { hasGroupsAccess } from "@/services/userSettings.service";
import { debugLog } from "@/utils/debugMode";
import { getNavItemTheme } from "@/utils/themeColors";

import ModeToggle from "./ModeToggle";
import { OfflineIndicator } from "./OfflineIndicator";
export default function DashboardNav() {
  const { t } = useTranslation();
  const { user, handleLogout } = useAuth();
  const isOnline = useOnlineStatus();
  const {
    showFeedbackModal,
    handleFeedbackClick,
    closeFeedbackModal,
    handleSubmitFeedback
  } = useFeedback();
  const { hasAccess: showWizardButton, loading: prepModeLoading } = usePrepModeAccess();
  debugLog('🔧 DashboardNav: showWizardButton:', showWizardButton, 'prepModeLoading:', prepModeLoading);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navDropdownOpen, setNavDropdownOpen] = useState(false);
  const [showGroupsNav, setShowGroupsNav] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navItems = useMemo(() => (
    primaryNavItems
      .filter((item) => showGroupsNav || item.key !== 'groups')
      .map((item) => ({
        ...item,
        label: t(item.labelKey, { defaultValue: item.defaultLabel })
      }))
  ), [t, showGroupsNav]);
  const workspaceNavItems = navItems.filter((item) => item.key !== 'settings');
  const settingsNavItem = navItems.find((item) => item.key === 'settings');
  const SettingsIcon = settingsNavItem?.icon;
  const currentNavItem = navItems.find((item) => isNavItemActive(pathname, item.matchers));
  const settingsActive = settingsNavItem ? isNavItemActive(pathname, settingsNavItem.matchers) : false;

  useEffect(() => {
    let isActive = true;

    async function checkGroupsAccess() {
      if (!user?.uid) {
        if (isActive) setShowGroupsNav(false);
        return;
      }

      const hasAccess = await hasGroupsAccess(user.uid);
      if (isActive) {
        setShowGroupsNav(hasAccess);
      }
    }

    checkGroupsAccess();
    return () => {
      isActive = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    const handleGroupsFeatureUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      if (typeof customEvent.detail === 'boolean') {
        setShowGroupsNav(customEvent.detail);
      }
    };

    window.addEventListener('groups-feature-updated', handleGroupsFeatureUpdated as EventListener);
    return () => {
      window.removeEventListener('groups-feature-updated', handleGroupsFeatureUpdated as EventListener);
    };
  }, []);

  // Function to close mobile menu and nav dropdown when path changes
  useEffect(() => {
    setMobileMenuOpen(false);
    setNavDropdownOpen(false);
  }, [pathname]);

  // Mode toggle visibility and handlers (sermon detail only)
  const isSermonRoot = /^\/sermons\/[^/]+$/.test(pathname || "");
  // Check if we're on any sermon-related page
  const isSermonRelated = /^\/sermons\//.test(pathname || "") || pathname === '/structure';

  // Get current mode directly from URL params for immediate response
  const currentMode = (searchParams?.get('mode') === 'prep') ? 'prep' : 'classic';

  const setMode = (mode: 'classic' | 'prep') => {
    try {
      // Check if we're trying to switch to the same mode
      if (mode === currentMode) {
        console.log('Already in', mode, 'mode');
        return;
      }

      console.log('Switching from', currentMode, 'to', mode, 'mode');

      const params = new URLSearchParams(searchParams?.toString() || '');
      if (mode === 'classic') {
        params.delete('mode');
      } else {
        params.set('mode', 'prep');
      }
      const query = params.toString();

      // Use push for better navigation
      const newUrl = `${pathname}${query ? `?${query}` : ''}`;
      console.log('Navigating to:', newUrl);

      router.push(newUrl, { scroll: false });

      console.log('Successfully switched to', mode, 'mode');
    } catch (error) {
      console.error('Error switching mode:', error);
    }
  };

  // Handle submitting feedback with user info
  const submitFeedbackWithUser = async (text: string, type: string, images: string[]) => {
    return handleSubmitFeedback(text, type, images, user?.uid || 'anonymous', user?.email || '');
  };

  // Handle clicks outside of nav dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (navDropdownOpen && !(e.target as Element).closest('.nav-dropdown-container')) {
        setNavDropdownOpen(false);
      }
    };

    if (navDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [navDropdownOpen]);

  return (
    <nav className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/95 shadow-sm backdrop-blur dark:border-gray-700/70 dark:bg-gray-950/95">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        {/* Desktop Layout */}
        <div className="hidden lg:flex h-16 items-center gap-4 relative">
          {/* Left: Logo */}
          <Link
            href="/dashboard"
            prefetch={isOnline}
            className="group flex shrink-0 items-center gap-2 rounded-full pr-2 text-base font-semibold text-gray-950 transition hover:text-blue-700 dark:text-gray-100 dark:hover:text-blue-300"
            aria-label={t('navigation.dashboard') as string}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-950/10 transition group-hover:shadow-blue-500/20 dark:from-blue-500 dark:to-indigo-500">
              <BookOpenIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="hidden whitespace-nowrap xl:inline">
              {t('navigation.appName', { defaultValue: 'My Preacher Helper' })}
            </span>
          </Link>

          {/* Navigation */}
          {isSermonRelated ? (
            // Navigation dropdown for sermon pages
            <div className="nav-dropdown-container relative">
              <button
                onClick={() => setNavDropdownOpen(!navDropdownOpen)}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-gray-200/80 bg-gray-50/90 px-3 text-sm font-medium text-gray-700 shadow-sm transition hover:border-blue-200 hover:bg-white hover:text-gray-950 dark:border-gray-700/70 dark:bg-gray-900/80 dark:text-gray-200 dark:hover:border-blue-500/40 dark:hover:bg-gray-900 dark:hover:text-white"
                aria-label="Navigation menu"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                <span suppressHydrationWarning={true}>{t('navigation.primary', { defaultValue: 'Navigation' })}</span>
                <svg className={`h-4 w-4 transition-transform ${navDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {navDropdownOpen && (
                <div className="absolute left-0 top-12 z-50 w-60 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/30">
                  {workspaceNavItems.map((item) => {
                    const active = isNavItemActive(pathname, item.matchers);
                    const Icon = item.icon;
                    const themeClasses = getNavItemTheme(item.theme);
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        prefetch={isOnline}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${active
                          ? themeClasses.menu
                          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                          }`}
                        onClick={() => setNavDropdownOpen(false)}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span suppressHydrationWarning={true}>{item.label}</span>
                        {item.isBeta && (
                          <span className="ml-1 text-[10px] uppercase font-bold px-1 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 rounded leading-tight">
                            Beta
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // Regular navigation for other pages
            <ul
              className="flex min-w-0 items-center gap-1 overflow-hidden rounded-full border border-gray-200/70 bg-gray-50/85 p-1 shadow-inner shadow-white/60 dark:border-gray-700/60 dark:bg-gray-900/70 dark:shadow-black/20"
              aria-label={t('navigation.primary', { defaultValue: 'Primary navigation' }) ?? 'Primary navigation'}
            >
              {workspaceNavItems.map((item) => {
                const active = isNavItemActive(pathname, item.matchers);
                const Icon = item.icon;
                const themeClasses = getNavItemTheme(item.theme);
                return (
                  <li key={item.key} className="shrink-0">
                    <Link
                      href={item.href}
                      prefetch={isOnline}
                      aria-current={active ? 'page' : undefined}
                      aria-label={item.label}
                      className={`inline-flex h-8 max-w-[9.75rem] items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-sm font-medium transition ${active
                        ? themeClasses.pill
                        : 'border-transparent text-gray-600 hover:border-gray-200 hover:bg-white hover:text-gray-950 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-white'
                        }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="hidden min-w-0 truncate xl:inline" suppressHydrationWarning={true}>
                        {item.label}
                      </span>
                      {item.isBeta && (
                        <span className="hidden rounded bg-blue-100 px-1 text-[10px] font-bold uppercase leading-tight text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 2xl:inline">
                          Beta
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Spacer to push controls right */}
          <div className="flex-1" />

          {/* Center: Mode toggle (desktop) */}
          {showWizardButton && isSermonRoot && !prepModeLoading && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <ModeToggle currentMode={currentMode} onSetMode={setMode} tSwitchToClassic={t('wizard.switchToClassic') as string} tSwitchToPrep={t('wizard.switchToPrepBeta') as string} tPrepLabel={t('wizard.previewButton') as string} />
            </div>
          )}

          {/* Right: Desktop controls */}
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200/70 bg-gray-50/85 px-2 py-1 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/70">
            <OfflineIndicator />
            {/* Feedback button for desktop */}
            <button
              onClick={handleFeedbackClick}
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 text-sm font-semibold text-white shadow-sm shadow-blue-950/10 transition-all hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:from-blue-500 dark:to-indigo-500 dark:hover:from-blue-400 dark:hover:to-indigo-400 dark:focus:ring-offset-gray-950"
              aria-label="Provide feedback"
            >
              <ChatBubbleLeftEllipsisIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden xl:inline" suppressHydrationWarning={true}>
                {t('feedback.button') || 'Feedback'}
              </span>
            </button>
            {settingsNavItem && SettingsIcon && (
              <Link
                href={settingsNavItem.href}
                prefetch={isOnline}
                aria-current={settingsActive ? 'page' : undefined}
                aria-label={settingsNavItem.label}
                title={settingsNavItem.label}
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${settingsActive
                  ? 'border-blue-500 bg-blue-50 text-blue-600 shadow-sm dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'border-transparent text-gray-500 hover:border-gray-200 hover:bg-white hover:text-gray-950 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-white'
                  }`}
              >
                <SettingsIcon className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
            <div className="language-container">
              <LanguageSwitcher />
            </div>
            <UserProfileDropdown
              user={user}
              onLogout={handleLogout}
            />
          </div>
        </div>

        {/* Mobile Layout */}
        <div className="lg:hidden py-3">
          <div className="flex items-center justify-between relative">
            {/* Left: Hamburger Menu */}
            <div className="flex items-center z-10">
              <button
                type="button"
                className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100 focus:outline-none"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                <span className="sr-only">Open menu</span>
                {mobileMenuOpen ? (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>

            {/* Center: Title */}
            <div className="absolute left-0 right-0 flex justify-center pointer-events-none">
              <Link
                href={currentNavItem?.href || "/dashboard"}
                prefetch={isOnline}
                className="flex items-center text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent pointer-events-auto"
              >
                <span suppressHydrationWarning={true}>
                  {currentNavItem?.label || t('navigation.dashboard')}
                </span>
              </Link>
            </div>

            {/* Right: Mobile controls */}
            <div className="flex items-center gap-2 z-10">
              <OfflineIndicator />
              {/* Feedback button for mobile */}
              <button
                onClick={handleFeedbackClick}
                className="text-sm px-2 py-1 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-md flex items-center"
                aria-label="Provide feedback"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902 1.168.188 2.352.327 3.55.414.28.02.521.18.642.413l1.713 3.293a.75.75 0 001.33 0l1.713-3.293a.783.783 0 01.642-.413 41.102 41.102 0 003.55-.414c1.437-.231 2.43-1.49 2.43-2.902V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.102 0 0010 2z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <MobileMenu
        isOpen={mobileMenuOpen}
        onLogout={handleLogout}
        pathname={pathname || ''}
        showGroups={showGroupsNav}
        onNavigate={() => setMobileMenuOpen(false)}
      />

      {/* Feedback Modal */}
      <FeedbackModal
        isOpen={showFeedbackModal}
        onClose={closeFeedbackModal}
        onSubmit={submitFeedbackWithUser}
      />
    </nav>
  );
}

// Mode toggle extracted to separate component for testability (see ModeToggle.tsx)
