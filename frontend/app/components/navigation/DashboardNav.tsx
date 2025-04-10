'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/components/navigation/LanguageSwitcher";
import UserProfileDropdown from "@/components/navigation/UserProfileDropdown";
import MobileMenu from "@/components/navigation/MobileMenu";
import FeedbackModal from "@/components/navigation/FeedbackModal";
import { useAuth } from "@/hooks/useAuth";
import { useFeedback } from "@/hooks/useFeedback";
import "@locales/i18n";

export default function DashboardNav() {
  const { t } = useTranslation();
  const { user, handleLogout } = useAuth();
  const { 
    showFeedbackModal, 
    handleFeedbackClick, 
    closeFeedbackModal, 
    handleSubmitFeedback 
  } = useFeedback();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  // Function to close mobile menu when path changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Handle submitting feedback with user info
  const submitFeedbackWithUser = async (text: string, type: string) => {
    return handleSubmitFeedback(text, type, user?.uid || 'anonymous');
  };

  return (
    <nav className="sticky top-0 z-40 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Logo section */}
          <Link href="/dashboard" className="flex items-center text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            <span suppressHydrationWarning={true}>
              {t('navigation.dashboard')}
            </span>
          </Link>

          {/* Desktop navigation items */}
          <div className="hidden md:flex items-center gap-4">
            {/* Feedback button for desktop */}
            <button
              onClick={handleFeedbackClick}
              className="text-sm px-3 py-1.5 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-md hover:from-blue-600 hover:to-purple-700 transition-all font-medium flex items-center gap-1"
              aria-label="Provide feedback"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902 1.168.188 2.352.327 3.55.414.28.02.521.18.642.413l1.713 3.293a.75.75 0 001.33 0l1.713-3.293a.783.783 0 01.642-.413 41.102 41.102 0 003.55-.414c1.437-.231 2.43-1.49 2.43-2.902V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0010 2z" clipRule="evenodd" />
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

          {/* Mobile right-side controls: Feedback button and menu */}
          <div className="flex md:hidden items-center gap-2">
            {/* Feedback button for mobile - always visible */}
            <button
              onClick={handleFeedbackClick}
              className="text-sm px-2 py-1 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-md flex items-center"
              aria-label="Provide feedback"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902 1.168.188 2.352.327 3.55.414.28.02.521.18.642.413l1.713 3.293a.75.75 0 001.33 0l1.713-3.293a.783.783 0 01.642-.413 41.102 41.102 0 003.55-.414c1.437-.231 2.43-1.49 2.43-2.902V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0010 2z" clipRule="evenodd" />
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

      {/* Mobile menu */}
      <MobileMenu 
        isOpen={mobileMenuOpen} 
        onLogout={handleLogout} 
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
