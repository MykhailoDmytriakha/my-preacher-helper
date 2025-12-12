"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

import { SERMON_SECTION_COLORS } from "@/utils/themeColors";
import { getFocusModeButtonColors } from "@/utils/themeColors";
import { getFocusModeUrl } from "@/utils/urlUtils";

import type { Sermon } from "@/models/models";

interface StructureStatsProps {
  sermon: Sermon;
  tagCounts: {
    [key: string]: number;
  };
  totalThoughts: number;
  hasInconsistentThoughts?: boolean;
}

const StructureStats: React.FC<StructureStatsProps> = ({
  sermon,
  tagCounts,
  totalThoughts,
  hasInconsistentThoughts = false,
}) => {
  const { t } = useTranslation();

  // Use direct translation calls to avoid duplicate string warnings
  const structureEntriesTranslationKey = 'structure.entries';
  const structureRecommendedTranslationKey = 'structure.recommended';
  const structureFocusModeTranslationKey = 'structure.focusMode';

  const intro = tagCounts["Вступление"] || 0;
  const main = tagCounts["Основная часть"] || 0;
  const conclusion = tagCounts["Заключение"] || 0;

  const introPercentage = totalThoughts
    ? Math.round((intro / totalThoughts) * 100)
    : 0;
  const mainPercentage = totalThoughts
    ? Math.round((main / totalThoughts) * 100)
    : 0;
  const conclusionPercentage = totalThoughts
    ? Math.round((conclusion / totalThoughts) * 100)
    : 0;

  // Default colors
  const introColor = SERMON_SECTION_COLORS.introduction.base;
  const mainColor = SERMON_SECTION_COLORS.mainPart.base;
  const conclusionColor = SERMON_SECTION_COLORS.conclusion.base;

  return (
    <div className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
      <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4">{t('structure.title')}</h2>
      <div className="space-y-3 sm:space-y-4">
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden relative">
          <div className="absolute inset-0 flex">
            <div
              className="transition-all duration-500"
              style={{
                width: totalThoughts ? `${introPercentage}%` : "0%",
                backgroundColor: introColor,
              }}
              data-tooltip={`${t('tags.introduction')}: ${intro} ${t(structureEntriesTranslationKey)}`}
            />
            <div
              className="transition-all duration-500"
              style={{
                width: totalThoughts ? `${mainPercentage}%` : "0%",
                backgroundColor: mainColor,
              }}
              data-tooltip={`${t('tags.mainPart')}: ${main} ${t(structureEntriesTranslationKey)}`}
            />
            <div
              className="transition-all duration-500"
              style={{
                width: totalThoughts ? `${conclusionPercentage}%` : "0%",
                backgroundColor: conclusionColor,
              }}
              data-tooltip={`${t('tags.conclusion')}: ${conclusion} ${t(structureEntriesTranslationKey)}`}
            />
          </div>
        </div>
        <div className="flex items-stretch text-xs sm:text-sm">
          <div className="flex-1 flex flex-col items-center text-center" style={{ color: introColor }}>
            <div className="text-base sm:text-lg font-bold">{introPercentage}%</div>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              &ldquo;{t('tags.introduction')}&rdquo; <br />
              {t(structureRecommendedTranslationKey, { percent: 20 })}
            </span>
            <div className="mt-auto pt-2">
              <Link
                href={getFocusModeUrl('introduction', sermon.id)}
                className={`inline-flex items-center justify-center h-9 px-3 ${getFocusModeButtonColors('introduction').bg} ${getFocusModeButtonColors('introduction').hover} ${getFocusModeButtonColors('introduction').text} rounded text-xs transition-colors`}
              >
                {t(structureFocusModeTranslationKey)}
              </Link>
            </div>
          </div>
          <div className="self-stretch w-px bg-gray-200 dark:bg-gray-700 mx-2 sm:mx-4" />
          <div className="flex-1 flex flex-col items-center text-center" style={{ color: mainColor }}>
            <div className="text-base sm:text-lg font-bold">{mainPercentage}%</div>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              &ldquo;{t('tags.mainPart')}&rdquo;
              <br />
              {t(structureRecommendedTranslationKey, { percent: 60 })}
            </span>
            <div className="mt-auto pt-2">
              <Link
                href={getFocusModeUrl('main', sermon.id)}
                className={`inline-flex items-center justify-center h-9 px-3 ${getFocusModeButtonColors('mainPart').bg} ${getFocusModeButtonColors('mainPart').hover} ${getFocusModeButtonColors('mainPart').text} rounded text-xs transition-colors`}
              >
                {t(structureFocusModeTranslationKey)}
              </Link>
            </div>
          </div>
          <div className="self-stretch w-px bg-gray-200 dark:bg-gray-700 mx-2 sm:mx-4" />
          <div className="flex-1 flex flex-col items-center text-center" style={{ color: conclusionColor }}>
            <div className="text-base sm:text-lg font-bold">{conclusionPercentage}%</div>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              &ldquo;{t('tags.conclusion')}&rdquo; <br />
              {t(structureRecommendedTranslationKey, { percent: 20 })}
            </span>
            <div className="mt-auto pt-2">
              <Link
                href={getFocusModeUrl('conclusion', sermon.id)}
                className={`inline-flex items-center justify-center h-9 px-3 ${getFocusModeButtonColors('conclusion').bg} ${getFocusModeButtonColors('conclusion').hover} ${getFocusModeButtonColors('conclusion').text} rounded text-xs transition-colors`}
              >
                {t(structureFocusModeTranslationKey)}
              </Link>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 sm:mt-6">
        <StructurePlanToggle 
          sermonId={sermon.id}
          hasInconsistentThoughts={hasInconsistentThoughts}
          t={t}
        />
      </div>
    </div>
  );
};

// New component for structure/plan toggle
const StructurePlanToggle: React.FC<{
  sermonId: string;
  hasInconsistentThoughts: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}> = ({ sermonId, hasInconsistentThoughts, t }) => {
  const router = useRouter();
  
  return (
    <div className="relative inline-flex items-center rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden w-full shadow-sm hover:shadow-md transition-shadow duration-200">
      {/* Gradient background that spans both buttons */}
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-500 dark:to-fuchsia-500 transition-all duration-300 ease-in-out"
        style={{
          width: '100%',
          opacity: hasInconsistentThoughts ? 0.3 : 1,
        }}
      />
      
      {/* ThoughtsBySection button */}
      <button
        type="button"
        onClick={() => !hasInconsistentThoughts && router.push(`/sermons/${sermonId}/structure`)}
        disabled={hasInconsistentThoughts}
        className={`relative z-10 px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out rounded-l-full flex-1 ${
          hasInconsistentThoughts 
            ? 'text-gray-400 cursor-not-allowed' 
            : 'text-white hover:scale-105 hover:shadow-lg active:scale-95'
        }`}
        title={hasInconsistentThoughts ? t('structure.inconsistentTagsWarning') : ''}
      >
        {t('structure.workButton')}
      </button>
      
      {/* White separator line */}
      <div className="relative z-20 w-0.5 h-6 bg-white/90 dark:bg-white/70 mx-1 rounded-full shadow-sm" />
      
      {/* Plan button */}
      <button
        type="button"
        onClick={() => router.push(`/sermons/${sermonId}/plan`)}
        className="relative z-10 px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out rounded-r-full text-white hover:scale-105 hover:shadow-lg active:scale-95 flex-1"
      >
        {t('plan.pageTitle')}
      </button>
    </div>
  );
};

export default StructureStats;
