'use client';

import { BookOpenIcon, ChatBubbleLeftEllipsisIcon } from '@heroicons/react/24/solid';
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

import FeedbackModal from "@/components/navigation/FeedbackModal";
import LanguageSwitcher from "@/components/navigation/LanguageSwitcher";
import MobileMenu from "@/components/navigation/MobileMenu";
import { primaryNavItems, isNavItemActive } from "@/components/navigation/navConfig";
import UserProfileDropdown from "@/components/navigation/UserProfileDropdown";
import {
  UsageGraceController,
  UsageGraceIndicator,
  type UsageGraceViewModel,
} from '@/components/usage/UsageGraceIndicator';
import { useAuth } from "@/hooks/useAuth";
import { useFeedback } from "@/hooks/useFeedback";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePrepModeAccess } from "@/hooks/usePrepModeAccess";
import { useShellPathname } from "@/hooks/useShellPathname";
import { hasGroupsAccess } from "@/services/userSettings.service";
import { debugLog } from "@/utils/debugMode";
import { getNavItemTheme } from "@/utils/themeColors";
import { isConductRoute } from '@/utils/usageGrace';

import { AppUpdateButton } from "./AppUpdateButton";
import ModeToggle, { type SermonMode } from "./ModeToggle";
import { OfflineIndicator } from "./OfflineIndicator";

const parseSermonMode = (value: string | null | undefined): SermonMode | null => {
  if (value === 'prep' || value === 'classic' || value === 'raw') return value;
  return null;
};

const getSermonIdFromPathname = (pathname: string | null | undefined) => {
  const match = pathname?.match(/^\/sermons\/([^/]+)$/);
  return match?.[1] ?? null;
};

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
  const [showGroupsNav, setShowGroupsNav] = useState(true);
  const pathname = useShellPathname();
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

  // Function to close mobile menu when path changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Mode toggle visibility and handlers (sermon detail only)
  const isSermonRoot = /^\/sermons\/[^/]+$/.test(pathname || "");
  const sermonIdForMode = getSermonIdFromPathname(pathname);
  // Check if we're on any sermon-related page
  const isSermonRelated = /^\/sermons\//.test(pathname || "") || pathname === '/structure';
  const [savedMode, setSavedMode] = useState<SermonMode>('classic');

  // Get current mode directly from URL params for immediate response
  const modeFromUrl = parseSermonMode(searchParams?.get('mode'));
  const currentMode = modeFromUrl ?? savedMode;

  useEffect(() => {
    if (!isSermonRoot || !sermonIdForMode || typeof window === 'undefined') {
      setSavedMode('classic');
      return;
    }

    const storedMode = parseSermonMode(localStorage.getItem(`sermon-${sermonIdForMode}-mode`));
    setSavedMode(storedMode ?? 'classic');
  }, [isSermonRoot, sermonIdForMode]);

  const setMode = (mode: SermonMode) => {
    try {
      if (mode === 'prep' && !showWizardButton) return;

      // Check if we're trying to switch to the same mode
      if (mode === currentMode) {
        debugLog('Already in mode', mode);
        return;
      }

      debugLog('Switching sermon mode', { from: currentMode, to: mode });

      const params = new URLSearchParams(searchParams?.toString() || '');
      params.set('mode', mode);
      if (sermonIdForMode && typeof window !== 'undefined') {
        localStorage.setItem(`sermon-${sermonIdForMode}-mode`, mode);
      }
      setSavedMode(mode);
      const query = params.toString();

      // Use push for better navigation
      const newUrl = `${pathname}${query ? `?${query}` : ''}`;
      debugLog('Navigating to sermon mode URL', newUrl);

      router.push(newUrl, { scroll: false });

      debugLog('Successfully switched sermon mode', mode);
    } catch (error) {
      console.error('Error switching mode:', error);
    }
  };

  // Handle submitting feedback with user info
  const submitFeedbackWithUser = async (text: string, type: string, images: string[]) => {
    return handleSubmitFeedback(text, type, images, user?.uid || 'anonymous');
  };

  const modeToggle = isSermonRoot && !prepModeLoading ? (
    <ModeToggle
      currentMode={currentMode}
      onSetMode={setMode}
      canUsePrep={showWizardButton}
      tSwitchToClassic={t('wizard.switchToClassic') as string}
      tSwitchToPrep={t('wizard.switchToPrepBeta') as string}
      tSwitchToRaw={t('wizard.switchToRaw') as string}
      tPrepLabel={t('wizard.modePrep') as string}
      tClassicLabel={t('wizard.modeClassic') as string}
      tRawLabel={t('wizard.modeRaw') as string}
    />
  ) : null;

  const renderNavigation = (usageGrace: UsageGraceViewModel | null) => (
    <nav className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/95 shadow-sm backdrop-blur dark:border-gray-700/70 dark:bg-gray-950/95">
      <div className="relative w-full px-4 sm:px-6 lg:px-8">
        {/* Desktop Layout */}
        <div className="hidden lg:flex h-16 items-center gap-4 relative">
          {/*
            Left: Logo — and NOT on sermon pages.
            It is a link to the dashboard, which the very first icon of the nav
            already is, so on the one screen where width is scarce it costs room
            and gives a second way to do the same thing. The wordmark says what
            the app is; a person editing a sermon inside it already knows.
          */}
          {!isSermonRelated && (
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
          )}

          {/*
            ONE NAVIGATION, TWO SIZES — never a different navigation.
            Sermon pages used to hide the sections behind a "Navigation" dropdown,
            so leaving a sermon cost two clicks and a guess, while every other page
            kept them one click away. What is actually scarce there is width: the
            mode toggle sits in the middle of the bar. So the labels go and the
            icons stay out in the open — the accessible name still carries the
            label, and `title` gives it back on hover.
          */}
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
                    title={isSermonRelated ? item.label : undefined}
                    /*
                      ONE HEIGHT ACROSS THE WHOLE BAR: every target in the header is
                      36px, so every capsule around one measures 46px (36 + p-1 on
                      both sides + the border) and everything shares a centre line.
                      Before this the bar mixed 32, 36, 40 and 42px — near-misses
                      the eye catches without being able to name. Only the shape
                      adapts to the page: labelled pills where there is room, square
                      icons on sermon pages where there is not.
                    */
                    className={`inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full border text-sm font-medium transition ${isSermonRelated
                      ? 'w-9'
                      : 'max-w-[9.75rem] gap-1.5 px-2.5'
                      } ${active
                        ? themeClasses.pill
                        : `border-transparent text-gray-600 dark:text-gray-300 ${themeClasses.hover}`
                      }`}
                  >
                    <Icon className={`shrink-0 ${isSermonRelated ? 'h-[18px] w-[18px]' : 'h-4 w-4'}`} aria-hidden="true" />
                    {!isSermonRelated && (
                      <>
                        <span className="hidden min-w-0 truncate xl:inline" suppressHydrationWarning={true}>
                          {item.label}
                        </span>
                        {item.isBeta && (
                          <span className="hidden rounded bg-blue-100 px-1 text-[10px] font-bold uppercase leading-tight text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 2xl:inline">
                            Beta
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Spacer to push controls right */}
          <div className="flex-1" />

          {/* Right: Desktop controls */}
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200/70 bg-gray-50/85 px-2 py-1 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/70">
            {usageGrace && <UsageGraceIndicator model={usageGrace} placement="desktop" />}
            <AppUpdateButton />
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
              {/* Same 36px target as everything else in the bar — and on a phone it
                  is also the difference between a comfortable tap and a careful one. */}
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-gray-100"
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
              {usageGrace && <UsageGraceIndicator model={usageGrace} placement="mobile" />}
              <AppUpdateButton />
              <OfflineIndicator />
              {/* Feedback button for mobile */}
              <button
                onClick={handleFeedbackClick}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-purple-600 text-sm text-white"
                aria-label="Provide feedback"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px]">
                  <path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902 1.168.188 2.352.327 3.55.414.28.02.521.18.642.413l1.713 3.293a.75.75 0 001.33 0l1.713-3.293a.783.783 0 01.642-.413 41.102 41.102 0 003.55-.414c1.437-.231 2.43-1.49 2.43-2.902V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.102 0 0010 2z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        {modeToggle && (
          <div className="mt-3 flex justify-center pb-3 lg:absolute lg:left-1/2 lg:top-1/2 lg:mt-0 lg:block lg:-translate-x-1/2 lg:-translate-y-1/2 lg:p-0">
            {modeToggle}
          </div>
        )}
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

  if (isConductRoute(pathname)) return renderNavigation(null);

  return (
    <UsageGraceController user={user} devUsageParam={searchParams?.get('devUsage')}>
      {renderNavigation}
    </UsageGraceController>
  );
}

// Mode toggle extracted to separate component for testability (see ModeToggle.tsx)
