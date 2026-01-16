'use client';

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
import { getNavItemTheme } from "@/utils/themeColors";

import ModeToggle from "./ModeToggle";
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
  console.log('🔧 DashboardNav: showWizardButton:', showWizardButton, 'prepModeLoading:', prepModeLoading);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navDropdownOpen, setNavDropdownOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navItems = useMemo(() => (
    primaryNavItems.map((item) => ({
      ...item,
      label: t(item.labelKey, { defaultValue: item.defaultLabel })
    }))
  ), [t]);

  // Function to close mobile menu and nav dropdown when path changes
  useEffect(() => {
    setMobileMenuOpen(false);
    setNavDropdownOpen(false);
  }, [pathname]);

  // Mode toggle visibility and handlers (sermon detail only)
  const isSermonRoot = /^\/sermons\/[^/]+$/.test(pathname || "");
  // Check if we're on any sermon-related page
  const isSermonRelated = /^\/sermons\//.test(pathname || "") || pathname === '/structure';
  const isDashboard = pathname === '/dashboard';
  
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
  const submitFeedbackWithUser = async (text: string, type: string) => {
    return handleSubmitFeedback(text, type, user?.uid || 'anonymous');
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
    <nav className="sticky top-0 z-40 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        {/* Desktop Layout */}
        <div className="hidden md:flex h-16 items-center gap-4">
          {/* Left: Logo */}
          <Link
            href="/dashboard"
            prefetch={isOnline}
            className="flex items-center text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent"
            aria-label={t('navigation.dashboard') as string}
          >
          </Link>

          {/* Navigation */}
          {isSermonRelated ? (
            // Navigation dropdown for sermon pages
            <div className="nav-dropdown-container relative">
              <button
                onClick={() => setNavDropdownOpen(!navDropdownOpen)}
                className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition border-transparent text-gray-600 hover:border-gray-200 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
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
                <div className="absolute left-0 top-12 w-56 bg-white dark:bg-gray-800 rounded-md shadow-lg py-2 border border-gray-200 dark:border-gray-700 z-50">
                  {navItems.map((item) => {
                    const active = isNavItemActive(pathname, item.matchers);
                    const Icon = item.icon;
                    const themeClasses = getNavItemTheme(item.theme);
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        prefetch={isOnline}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-2 px-4 py-2 text-sm transition ${
                          active
                            ? themeClasses.menu
                            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                        onClick={() => setNavDropdownOpen(false)}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span suppressHydrationWarning={true}>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // Regular navigation for other pages
            <ul
              className="flex items-center gap-2 min-w-0 flex-wrap"
              aria-label={t('navigation.primary', { defaultValue: 'Primary navigation' }) ?? 'Primary navigation'}
            >
              {navItems.map((item) => {
                const active = isNavItemActive(pathname, item.matchers);
                const Icon = item.icon;
                const themeClasses = getNavItemTheme(item.theme);
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      prefetch={isOnline}
                      aria-current={active ? 'page' : undefined}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition ${
                        active
                          ? themeClasses.pill
                          : 'border-transparent text-gray-600 hover:border-gray-200 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span suppressHydrationWarning={true}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Spacer to push mode toggle to center */}
          <div className="flex-1" />

          {/* Center: Mode toggle (desktop) */}
          {showWizardButton && isSermonRoot && !prepModeLoading && (
            <ModeToggle currentMode={currentMode} onSetMode={setMode} tSwitchToClassic={t('wizard.switchToClassic') as string} tSwitchToPrep={t('wizard.switchToPrepBeta') as string} tPrepLabel={t('wizard.previewButton') as string} />
          )}

          {/* Another spacer to balance */}
          <div className="flex-1" />

          {/* Right: Desktop controls */}
          <div className="flex items-center gap-4">
            {/* Feedback button for desktop */}
            <button
              onClick={handleFeedbackClick}
              className="text-sm px-3 py-1.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-md hover:from-blue-600 hover:to-purple-700 transition-all font-medium flex items-center gap-1"
              aria-label="Provide feedback"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902 1.168.188 2.352.327 3.55.414.28.02.521.18.642.413l1.713 3.293a.75.75 0 001.33 0l1.713-3.293a.783.783 0 01.642-.413 41.102 41.102 0 003.55-.414c1.437-.231 2.43-1.49 2.43-2.902V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.102 0 0010 2z" clipRule="evenodd" />
              </svg>
              <span suppressHydrationWarning={true}>
                {t('feedback.button') || 'Feedback'}
              </span>
            </button>
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
        <div className="md:hidden py-3">
          <div className="flex items-center justify-between">
            {/* Left: Logo */}
            <div className="flex items-center">
              <Link
                href="/dashboard"
                prefetch={isOnline}
                className="flex items-center text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent"
              >
                {!isDashboard && (
                  <span suppressHydrationWarning={true}>
                    {t('navigation.dashboard')}
                  </span>
                )}
              </Link>
            </div>

            {/* Right: Mobile controls */}
            <div className="flex items-center gap-2">
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

              {/* Mobile menu button */}
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
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <MobileMenu 
        isOpen={mobileMenuOpen} 
        onLogout={handleLogout}
        pathname={pathname || ''}
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
