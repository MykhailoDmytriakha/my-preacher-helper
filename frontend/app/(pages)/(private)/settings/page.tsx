'use client';

import { User } from "firebase/auth";
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LanguageInitializer from "@/components/navigation/LanguageInitializer";
import AudioGenerationToggle from "@/components/settings/AudioGenerationToggle";
import DebugModeToggle from "@/components/settings/DebugModeToggle";
import GroupsFeatureToggle from "@/components/settings/GroupsFeatureToggle";
import ModelSelector from "@/components/settings/ModelSelector";
import PlanTemplatesSection from "@/components/settings/PlanTemplatesSection";
import PrepModeToggle from "@/components/settings/PrepModeToggle";
import ReferralCard from "@/components/settings/ReferralCard";
import SettingsLayout from "@/components/settings/SettingsLayout";
import ShowVersionToggle from "@/components/settings/ShowVersionToggle";
import StructurePreviewToggle from "@/components/settings/StructurePreviewToggle";
import TagsSection from "@/components/settings/TagsSection";
import UsageWidget from "@/components/settings/UsageWidget";
import UserSettingsSection from "@/components/settings/UserSettingsSection";
import SettingsNav, { type SettingsSection } from "@components/settings/SettingsNav";
import { auth } from "@services/firebaseAuth.service";
import "@locales/i18n";

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('user');
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageTitle, setPageTitle] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Set title on client-side to avoid hydration issues
    setPageTitle(t('settings.title'));
  }, [t]);

  // Deep-link: open a specific section via ?section= (e.g. the plan editor's
  // "Manage templates" link points to /settings?section=planTemplates).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const section = new URLSearchParams(window.location.search).get('section');
    if (section === 'user' || section === 'aiModels' || section === 'tags' || section === 'planTemplates') {
      setActiveSection(section);
    }
  }, []);

  // Если пользователь не авторизован, перенаправляем на страницу входа
  useEffect(() => {
    let cancelled = false;
    let adminCheckId = 0;
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      const currentCheckId = ++adminCheckId;
      setUser(currentUser);
      setLoading(false);
      if (!currentUser) {
        setIsAdmin(false);
        window.location.href = '/';
        return;
      }

      setIsAdmin(false);
      if (typeof currentUser.getIdToken !== 'function') {
        return;
      }

      void (async () => {
        try {
          const token = await currentUser.getIdToken();
          const response = await fetch('/api/admin/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data: unknown = await response.json().catch(() => null);
          const admin = response.ok
            && data !== null
            && typeof data === 'object'
            && 'admin' in data
            && data.admin === true;
          if (!cancelled && currentCheckId === adminCheckId) setIsAdmin(admin);
        } catch {
          if (!cancelled && currentCheckId === adminCheckId) setIsAdmin(false);
        }
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'user':
        return (
          <div className="space-y-6">
            <ReferralCard user={user} />
            <UserSettingsSection user={user} />
            <PrepModeToggle />
            <AudioGenerationToggle />
            <StructurePreviewToggle />
            <GroupsFeatureToggle />
            <DebugModeToggle />
            <ShowVersionToggle />
          </div>
        );
      case 'tags':
        return <TagsSection user={user} />;
      case 'planTemplates':
        return <PlanTemplatesSection user={user} />;
      case 'aiModels':
        return (
          <div className="space-y-6">
            <UsageWidget user={user} />
            <ModelSelector user={user} />
          </div>
        );
      default:
        return (
          <div className="space-y-6">
            <ReferralCard user={user} />
            <UserSettingsSection user={user} />
            <PrepModeToggle />
            <StructurePreviewToggle />
            <GroupsFeatureToggle />
            <DebugModeToggle />
          </div>
        );
    }
  };

  // Custom handler for section change
  const handleSectionChange = (sectionId: SettingsSection) => {
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
          <div className="grid grid-cols-2 gap-1 p-2 bg-white dark:bg-gray-800 shadow rounded-lg">
            <SettingsNav
              isAdmin={isAdmin}
              activeSection={activeSection}
              onNavigate={(sectionId) => {
                if (sectionId === 'user' || sectionId === 'aiModels' || sectionId === 'tags' || sectionId === 'planTemplates') {
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
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-2 flex flex-col gap-1">
              <SettingsNav
                isAdmin={isAdmin}
                activeSection={activeSection}
                onNavigate={(sectionId) => {
                  if (sectionId === 'user' || sectionId === 'aiModels' || sectionId === 'tags' || sectionId === 'planTemplates') {
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
