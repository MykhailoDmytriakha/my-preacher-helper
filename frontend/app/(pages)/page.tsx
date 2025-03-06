'use client';
import { useState, useEffect } from 'react';
import useAuth from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import FeatureCards from '@/components/landing/FeatureCards';
import LoginOptions from '@/components/landing/LoginOptions';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import '@locales/i18n';

export default function Home() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, loading, loginWithGoogle, loginAsGuest, loginWithEmailAndPassword } = useAuth();

  useEffect(() => {
    if (user) {
      router.push('/dashboard');
    }
  }, [user, router]);

  if (loading) {
    return <div className="min-h-screen bg-white dark:bg-gray-900" />;
  }

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
      router.push('/dashboard');
    } catch (error) {
      console.error('Login error', error);
    }
  };

  const handleGuestLogin = async () => {
    try {
      await loginAsGuest();
      router.push('/dashboard');
    } catch (error) {
      console.error('Guest login error', error);
    }
  };

  const handleTestLogin = async () => {
    try {
      await loginWithEmailAndPassword('testuser@example.com', 'TestPassword123');
      router.push('/dashboard');
    } catch (error) {
      console.error('Test login failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-blue-50 dark:from-gray-900 dark:to-gray-800 flex flex-col">
      {/* Header with the centered title and language switcher */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-center items-center py-4 relative">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent text-center">
            <span suppressHydrationWarning={true}>
              {t('landing.title')}
            </span>
          </h1>
          <div className="absolute right-4">
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-grow flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-4xl text-center mb-12 space-y-4">
          <h2 className="text-4xl font-bold text-gray-900 dark:text-white animate-fade-in-up">
            <span suppressHydrationWarning={true}>
              {t('landing.welcome', {defaultValue: 'Welcome to Preacher Helper'})}
            </span>
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
            <span suppressHydrationWarning={true}>
              {t('landing.subtitle')}
            </span>
          </p>
          <div className="flex justify-center mt-6">
            <div className="h-1 w-20 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"></div>
          </div>
        </div>
        
        <div className="w-full max-w-6xl mb-16 px-4 sm:px-0">
          <FeatureCards />
        </div>
        
        {/* <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700"> */}
          <LoginOptions onGoogleLogin={handleLogin} onGuestLogin={handleGuestLogin} onTestLogin={handleTestLogin} />
        {/* </div> */}
      </main>
      
      <footer className="py-6 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500 dark:text-gray-400">
          &copy; {new Date().getFullYear()} Preacher Helper
        </div>
      </footer>
      
      <style jsx global>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.6s ease-out;
        }
      `}</style>
    </div>
  );
}