import React from "react";
import Link from "next/link";
import { useTranslation } from 'react-i18next';
import { getFocusModeUrl } from "@/utils/urlUtils";
import { getFocusModeButtonColors } from "@/utils/themeColors";

interface FocusNavProps {
  sermon: { id: string; title: string };
  sermonId?: string | null;
  focusedColumn: string | null;
  onToggleFocusMode: (columnId: string) => void;
  onNavigateToSection: (sectionId: string) => void;
}

export const FocusNav: React.FC<FocusNavProps> = ({
  sermon,
  sermonId,
  focusedColumn,
  onToggleFocusMode,
  onNavigateToSection,
}) => {
  const { t } = useTranslation();

  if (!focusedColumn) {
    return (
      <div className="text-center">
        <Link href={`/sermons/${sermon.id}`} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
          {t('structure.backToSermon')}
        </Link>
        <div className="mt-2 flex justify-center space-x-4">
          <span className="text-gray-600 dark:text-gray-400">{t('structure.focusMode')}:</span>
          <Link 
            href={sermonId ? getFocusModeUrl('introduction', sermonId) : '#'}
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
          >
            {t('structure.introduction')}
          </Link>
          <Link 
            href={sermonId ? getFocusModeUrl('main', sermonId) : '#'}
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
          >
            {t('structure.mainPart')}
          </Link>
          <Link 
            href={sermonId ? getFocusModeUrl('conclusion', sermonId) : '#'}
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
          >
            {t('structure.conclusion')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="flex justify-center items-center space-x-4">
        <Link href={`/sermons/${sermon.id}`} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
          {t('structure.backToSermon')}
        </Link>
        <span className="text-gray-400">•</span>
        <button
          onClick={() => onToggleFocusMode(focusedColumn)}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
        >
          {t('structure.normalMode')}
        </button>
      </div>
      <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        {t('structure.focusMode')}: {t(`structure.${focusedColumn === 'main' ? 'mainPart' : focusedColumn}`)}
      </div>
      
      {/* Navigation buttons for focus mode */}
      <div className="mt-4 flex flex-col items-center space-y-3">
        {/* Quick section navigation */}
        <div className="flex flex-wrap justify-center items-stretch gap-2">
          {(['introduction', 'mainPart', 'conclusion'] as const).map((section) => {
            const sectionKey = section === 'mainPart' ? 'main' : section;
            const buttonColors = getFocusModeButtonColors(section);
            const isActive = focusedColumn === sectionKey;
            
            return (
              <button
                key={section}
                onClick={() => onNavigateToSection(sectionKey)}
                className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 whitespace-nowrap ${
                  isActive
                    ? `${buttonColors.bg} ${buttonColors.text}`
                    : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'
                }`}
              >
                {t(`structure.${section}`)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
