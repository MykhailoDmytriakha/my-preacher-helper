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
    <div className="min-h-screen bg-white dark:bg-gray-900 flex flex-col">
      {/* Header with the centered title and language switcher */}
      <header className="sticky top-0 z-50 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-center items-center py-4 relative">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent text-center">
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
      <main className="flex-grow flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-2xl text-center mb-8">
          <p className="text-lg text-gray-600 dark:text-gray-300">
            <span suppressHydrationWarning={true}>
              {t('landing.subtitle')}
            </span>
          </p>
        </div>
        <FeatureCards />
        <LoginOptions onGoogleLogin={handleLogin} onGuestLogin={handleGuestLogin} onTestLogin={handleTestLogin} />
      </main>
    </div>
  );
}