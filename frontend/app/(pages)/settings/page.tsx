'use client';

import React, { useState, useEffect } from 'react';
import { User } from "firebase/auth";
import { auth } from "@services/firebaseAuth.service";
import { useTranslation } from 'react-i18next';
import TagsSection from "@components/settings/TagsSection";
import UserSettingsSection from "@components/settings/UserSettingsSection";
import SettingsLayout from "@components/settings/SettingsLayout";
import SettingsNav from "@components/settings/SettingsNav";
import LanguageInitializer from "@components/LanguageInitializer";
import "@locales/i18n";

export default function SettingsPage() {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'user' | 'tags'>('user');
  const [pageTitle, setPageTitle] = useState('');

  useEffect(() => {
    // Set title on client-side to avoid hydration issues
    setPageTitle(t('settings.title'));
  }, [t]);

  // Если пользователь не авторизован, перенаправляем на страницу входа
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      setLoading(false);
      if (!currentUser) {
        window.location.href = '/';
      }
    });
    return () => unsubscribe();
  }, []);

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'user':
        return <UserSettingsSection user={user} />;
      case 'tags':
        return <TagsSection user={user} />;
      default:
        return <UserSettingsSection user={user} />;
    }
  };

  // Отображаем сообщение загрузки, если пользователь еще не загружен
  if (loading) {
    return (
      <SettingsLayout title={pageTitle}>
        <div className="flex justify-center items-center min-h-[60vh] text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p><span suppressHydrationWarning={true}>{t('settings.loading')}</span></p>
          </div>
        </div>
      </SettingsLayout>
    );
  }

  // Если пользователь не авторизован, не отображаем содержимое
  if (!user) {
    return null;
  }

  // Отображаем содержимое страницы настроек
  return (
    <>
      <LanguageInitializer />
      <SettingsLayout title={pageTitle}>
        <div className="flex flex-col md:flex-row gap-8">
          <div className="md:w-64 flex-shrink-0">
            <SettingsNav
              activeSection={activeSection}
              onSectionChange={setActiveSection}
            />
          </div>
          
          <div className="flex-1 transition-opacity duration-200 ease-in-out">
            {renderActiveSection()}
          </div>
        </div>
      </SettingsLayout>
    </>
  );
} 