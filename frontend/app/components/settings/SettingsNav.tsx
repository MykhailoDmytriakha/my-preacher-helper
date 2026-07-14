'use client';

import { UserCircleIcon, SparklesIcon, TagIcon, DocumentTextIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import React from 'react';
import { useTranslation } from 'react-i18next';

export type SettingsSection = 'user' | 'tags' | 'planTemplates' | 'aiModels';

interface SettingsNavProps {
  activeSection: SettingsSection;
  onNavigate?: (section: string) => void;
  onSectionChange?: React.Dispatch<React.SetStateAction<SettingsSection>>;
  isAdmin?: boolean;
}

const sectionIcon: Record<SettingsSection, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  user: UserCircleIcon,
  aiModels: SparklesIcon,
  tags: TagIcon,
  planTemplates: DocumentTextIcon,
};

const SettingsNav: React.FC<SettingsNavProps> = ({
  activeSection,
  onNavigate,
  onSectionChange,
  isAdmin = false
}) => {
  const { t } = useTranslation();

  const sections: { id: SettingsSection; label: string }[] = [
    { id: 'user', label: t('settings.userSettings') },
    { id: 'aiModels', label: t('settings.nav.aiModels') },
    { id: 'tags', label: t('settings.manageTags') },
    { id: 'planTemplates', label: t('settings.planTemplates') }
  ];

  const handleSectionClick = (sectionId: SettingsSection) => {
    if (onSectionChange) {
      onSectionChange(sectionId);
    } else if (onNavigate) {
      onNavigate(sectionId);
    }
  };

  return (
    <>
      {sections.map((section) => {
        const Icon = sectionIcon[section.id];
        const active = activeSection === section.id;
        return (
          <button
            key={section.id}
            onClick={() => handleSectionClick(section.id)}
            aria-current={active ? 'page' : undefined}
            className={`w-full flex items-center justify-center md:justify-start gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              active
                ? 'bg-blue-600 text-white font-semibold shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Icon
              aria-hidden="true"
              className={`hidden md:block h-[18px] w-[18px] shrink-0 ${active ? 'text-white' : 'text-gray-400 dark:text-gray-500'}`}
            />
            <span suppressHydrationWarning={true}>{section.label}</span>
          </button>
        );
      })}
      {isAdmin && (
        <Link
          href="/admin"
          className="w-full flex items-center justify-center md:justify-start gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
        >
          <ShieldCheckIcon aria-hidden="true" className="hidden md:block h-[18px] w-[18px] shrink-0" />
          <span suppressHydrationWarning={true}>{t('settings.admin.goToAdmin')}</span>
        </Link>
      )}
    </>
  );
};

export default SettingsNav;
