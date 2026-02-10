'use client';

import { User } from "firebase/auth";
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LanguageInitializer from "@/components/navigation/LanguageInitializer";
import AudioGenerationToggle from "@/components/settings/AudioGenerationToggle";
import DebugModeToggle from "@/components/settings/DebugModeToggle";
import GroupsFeatureToggle from "@/components/settings/GroupsFeatureToggle";
import PrepModeToggle from "@/components/settings/PrepModeToggle";
import SettingsLayout from "@/components/settings/SettingsLayout";
import TagsSection from "@/components/settings/TagsSection";
import UserSettingsSection from "@/components/settings/UserSettingsSection";
import SettingsNav from "@components/settings/SettingsNav";
import { auth } from "@services/firebaseAuth.service";
import "@locales/i18n";

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<'user' | 'tags'>('user');
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
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
        return (
          <div className="space-y-6">
            <UserSettingsSection user={user} />
            <PrepModeToggle />
            <AudioGenerationToggle />
            <GroupsFeatureToggle />
            <DebugModeToggle />
          </div>
        );
      case 'tags':
        return <TagsSection user={user} />;
      default:
        return (
          <div className="space-y-6">
            <UserSettingsSection user={user} />
            <PrepModeToggle />
            <GroupsFeatureToggle />
            <DebugModeToggle />
          </div>
        );
    }
  };

  // Custom handler for section change
  const handleSectionChange = (sectionId: 'user' | 'tags') => {
    setActiveSection(sectionId);
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

  // Render settings content under the shared private layout container
  return (
    <>
      <LanguageInitializer />
      <SettingsLayout title={pageTitle}>
        {/* Mobile Navigation (horizontal, 2-column) - only visible on mobile */}
        <div className="block md:hidden mb-4">
          <div className="grid grid-cols-2 overflow-hidden shadow rounded-lg">
            <SettingsNav
              activeSection={activeSection}
              onNavigate={(sectionId) => {
                if (sectionId === 'user' || sectionId === 'tags') {
                  handleSectionChange(sectionId);
                }
              }}
            />
          </div>
        </div>

        {/* Desktop Layout (side-by-side) - only visible on desktop */}
        <div className="hidden md:flex md:flex-row md:gap-8">
          {/* Navigation sidebar for desktop */}
          <div className="w-64 flex-shrink-0">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <SettingsNav
                activeSection={activeSection}
                onNavigate={(sectionId) => {
                  if (sectionId === 'user' || sectionId === 'tags') {
                    handleSectionChange(sectionId);
                  }
                }}
              />
            </div>
          </div>

          {/* Main content area for desktop */}
          <div className="flex-1 transition-opacity duration-200 ease-in-out">
            {renderActiveSection()}
          </div>
        </div>

        {/* Mobile Content Area - only visible on mobile */}
        <div className="block md:hidden transition-opacity duration-200 ease-in-out">
          {renderActiveSection()}
        </div>
      </SettingsLayout>
    </>
  );
} 
