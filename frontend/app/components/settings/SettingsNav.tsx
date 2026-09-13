'use client';

import { UserCircleIcon, SparklesIcon, TagIcon, DocumentTextIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { SETTINGS_SECTIONS, settingsSectionHref, type SettingsSection } from '@/utils/settingsSections';

export type { SettingsSection };

interface SettingsNavProps {
  activeSection: SettingsSection;
  isAdmin?: boolean;
}

const sectionIcon: Record<SettingsSection, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  user: UserCircleIcon,
  limits: SparklesIcon,
  tags: TagIcon,
  templates: DocumentTextIcon,
};

const sectionLabelKey: Record<SettingsSection, string> = {
  user: 'settings.userSettings',
  limits: 'settings.nav.aiModels',
  tags: 'settings.manageTags',
  templates: 'settings.planTemplates',
};

const ITEM_CLASS = 'w-full flex items-center justify-center md:justify-start gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors';

/**
 * EVERY ITEM IS A LINK, because every section is an address.
 *
 * These were buttons that set a piece of state, which is why nothing could point at a
 * section: there was nothing to point AT. As links they also open in a new tab, answer the
 * back button and survive a reload — all of it for free, from the router.
 */
const SettingsNav: React.FC<SettingsNavProps> = ({ activeSection, isAdmin = false }) => {
  const { t } = useTranslation();

  return (
    <>
      {SETTINGS_SECTIONS.map((section) => {
        const Icon = sectionIcon[section];
        const active = activeSection === section;
        return (
          <Link
            key={section}
            href={settingsSectionHref(section)}
            aria-current={active ? 'page' : undefined}
            className={`${ITEM_CLASS} ${
              active
                ? 'bg-blue-600 text-white font-semibold shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Icon
              aria-hidden="true"
              className={`hidden md:block h-[18px] w-[18px] shrink-0 ${active ? 'text-white' : 'text-gray-400 dark:text-gray-500'}`}
            />
            <span suppressHydrationWarning={true}>{t(sectionLabelKey[section])}</span>
          </Link>
        );
      })}
      {isAdmin && (
        <Link
          href="/admin"
          className={`${ITEM_CLASS} font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40`}
        >
          <ShieldCheckIcon aria-hidden="true" className="hidden md:block h-[18px] w-[18px] shrink-0" />
          <span suppressHydrationWarning={true}>{t('settings.admin.goToAdmin')}</span>
        </Link>
      )}
    </>
  );
};

export default SettingsNav;
