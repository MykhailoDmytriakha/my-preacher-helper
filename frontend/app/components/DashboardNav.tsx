'use client';

import Link from "next/link";
import { logOut } from "@services/firebaseAuth.service";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@services/firebaseAuth.service";
import { submitFeedback } from "@services/feedback.service";
import { ChevronIcon } from "@components/Icons";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@components/LanguageSwitcher";
import "@locales/i18n";

export default function DashboardNav() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const router = useRouter();
  const avatarRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Memoize the logout handler to prevent unnecessary re-renders
  const handleLogout = useCallback(async () => {
    try {
      const currentLang = document.cookie.match(/lang=([^;]+)/)?.[1] || 'en';
      
      await logOut();
      localStorage.removeItem('guestUser');
      sessionStorage.clear();

      await i18n.changeLanguage(currentLang);
      document.cookie = `lang=${currentLang}; path=/; max-age=2592000`;
      
      // Use router.push instead of direct window.location manipulation
      router.push('/');
    } catch (error) {
      console.error('Logout failed:', error);
      router.refresh();
    }
  }, [router, i18n]);

  // Auth state effect
  useEffect(() => {
    let isMounted = true;
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // Only update state if component is still mounted
      if (isMounted) {
        setUser(currentUser);
        if (!currentUser) {
          router.push('/');
        }
      }
    });
    
    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [router]);

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

  // Function to close mobile menu when path changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Function to open feedback modal
  const handleFeedbackClick = () => {
    setShowFeedbackModal(true);
    // Close other menus when opening feedback
    setShowDropdown(false);
    setMobileMenuOpen(false);
  };

  // Function to close feedback modal
  const closeFeedbackModal = () => {
    setShowFeedbackModal(false);
  };

  // Function to submit feedback
  const handleSubmitFeedback = async (feedbackText: string, feedbackType: string) => {
    try {
      // Use the feedback service to submit feedback
      await submitFeedback(feedbackText, feedbackType, user?.uid || 'anonymous');
      
      // Add a slight delay to ensure the loading state is visible before closing the modal
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setShowFeedbackModal(false);
      alert(t('feedback.successMessage'));
    } catch (error) {
      console.error('Error submitting feedback:', error);
      
      // Add a slight delay before showing the error alert
      await new Promise(resolve => setTimeout(resolve, 500));
      
      alert(t('feedback.errorMessage'));
    }
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
            <div ref={avatarRef} className="avatar-container relative flex items-center gap-4">
              <button 
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 focus:outline-none"
                data-testid="avatar-button"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center text-white">
                  {user?.photoURL && !imgError ? (
                    <img 
                      src={user.photoURL} 
                      alt="Avatar" 
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
                  <Link
                    href="/settings"
                    className="block w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <span suppressHydrationWarning={true}>
                      {t('navigation.settings')}
                    </span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-2 text-sm text-left text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-700"
                  >
                    <span suppressHydrationWarning={true}>
                      {t('navigation.logout')}
                    </span>
                  </button>
                </div>
              )}
            </div>
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
      <div className={`${mobileMenuOpen ? 'block' : 'hidden'} md:hidden`}>
        <div className="px-2 pt-2 pb-3 space-y-1 border-t border-gray-200 dark:border-gray-700">
          <div className="flex justify-center py-2">
            <LanguageSwitcher />
          </div>
          {/* Remove feedback button from here since it's now always visible */}
          <Link
            href="/settings"
            className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 text-center"
          >
            <span suppressHydrationWarning={true}>
              {t('navigation.settings')}
            </span>
          </Link>
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 rounded-md text-base font-medium text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-700 text-center"
          >
            <span suppressHydrationWarning={true}>
              {t('navigation.logout')}
            </span>
          </button>
        </div>
      </div>

      {/* Feedback Modal */}
      {showFeedbackModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="feedback-modal" role="dialog" aria-modal="true">
          <div className="flex items-center justify-center min-h-screen p-4">
            {/* Modal backdrop */}
            <div className="fixed inset-0 bg-black bg-opacity-40 transition-opacity" aria-hidden="true" onClick={closeFeedbackModal}></div>
            
            {/* Modal content */}
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white" suppressHydrationWarning={true}>
                  {t('feedback.title') || 'Send Feedback'}
                </h3>
                <button 
                  type="button" 
                  className="text-gray-400 hover:text-gray-500 focus:outline-none" 
                  onClick={closeFeedbackModal}
                >
                  <span className="sr-only">Close</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <FeedbackForm onSubmit={handleSubmitFeedback} onCancel={closeFeedbackModal} />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

// Feedback Form Component
function FeedbackForm({ onSubmit, onCancel }: { onSubmit: (text: string, type: string) => Promise<void>, onCancel: () => void }) {
  const { t } = useTranslation();
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackType, setFeedbackType] = useState('suggestion');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (feedbackText.trim()) {
      try {
        setIsSubmitting(true);
        await onSubmit(feedbackText, feedbackType);
      } catch (error) {
        // Error is handled in the parent component
      } finally {
        setIsSubmitting(false);
      }
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" suppressHydrationWarning={true}>
          {t('feedback.typeLabel') || 'Feedback Type'}
        </label>
        <select
          value={feedbackType}
          onChange={(e) => setFeedbackType(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
          required
          disabled={isSubmitting}
        >
          <option value="suggestion" suppressHydrationWarning={true}>{t('feedback.typeSuggestion') || 'Suggestion'}</option>
          <option value="bug" suppressHydrationWarning={true}>{t('feedback.typeBug') || 'Bug Report'}</option>
          <option value="question" suppressHydrationWarning={true}>{t('feedback.typeQuestion') || 'Question'}</option>
          <option value="other" suppressHydrationWarning={true}>{t('feedback.typeOther') || 'Other'}</option>
        </select>
      </div>
      
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" suppressHydrationWarning={true}>
          {t('feedback.messageLabel') || 'Your Feedback'}
        </label>
        <textarea
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
          placeholder={t('feedback.messagePlaceholder') || 'Please tell us what you think...'}
          required
          disabled={isSubmitting}
        />
      </div>
      
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
          suppressHydrationWarning={true}
          disabled={isSubmitting}
        >
          {t('feedback.cancelButton') || 'Cancel'}
        </button>
        <button
          type="submit"
          className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
            isSubmitting 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700'
          }`}
          suppressHydrationWarning={true}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {t('feedback.sendingButton') || 'Sending...'}
            </span>
          ) : (
            t('feedback.submitButton') || 'Submit'
          )}
        </button>
      </div>
    </form>
  );
}
