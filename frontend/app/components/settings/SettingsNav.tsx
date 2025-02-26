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
    <div className="flex md:flex-col gap-2 mb-6 bg-white dark:bg-gray-800 rounded-lg shadow p-3 md:p-4 overflow-x-auto md:overflow-visible">
      {sections.map((section) => (
        <button
          key={section.id}
          onClick={() => handleSectionClick(section.id)}
          className={`px-4 py-2 rounded-lg text-left whitespace-nowrap transition-colors ${
            activeSection === section.id
              ? 'bg-blue-600 text-white font-medium'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <span suppressHydrationWarning={true}>{section.label}</span>
        </button>
      ))}
    </div>
  );
};

export default SettingsNav; 