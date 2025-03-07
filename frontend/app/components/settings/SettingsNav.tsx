'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

interface SettingsNavProps {
  activeSection: 'user' | 'tags';
  onNavigate?: (section: string) => void;
  onSectionChange?: React.Dispatch<React.SetStateAction<'user' | 'tags'>>;
}

const SettingsNav: React.FC<SettingsNavProps> = ({ 
  activeSection, 
  onNavigate,
  onSectionChange
}) => {
  const { t } = useTranslation();
  
  const sections = [
    { id: 'user', label: t('settings.userSettings') },
    { id: 'tags', label: t('settings.manageTags') }
  ];

  const handleSectionClick = (sectionId: string) => {
    if (onSectionChange && (sectionId === 'user' || sectionId === 'tags')) {
      onSectionChange(sectionId);
    } else if (onNavigate) {
      onNavigate(sectionId);
    }
  };
  
  return (
    <>
      {sections.map((section) => (
        <button
          key={section.id}
          onClick={() => handleSectionClick(section.id)}
          className={`w-full text-center md:text-left py-3 px-4 md:py-4 md:border-b md:border-gray-100 md:dark:border-gray-700 md:last:border-b-0 transition-colors ${
            activeSection === section.id
              ? 'bg-blue-600 text-white font-medium'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <span suppressHydrationWarning={true}>{section.label}</span>
        </button>
      ))}
    </>
  );
};

export default SettingsNav; 