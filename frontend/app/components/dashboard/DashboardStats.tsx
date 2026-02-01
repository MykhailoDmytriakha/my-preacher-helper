"use client";

import { useTranslation } from "react-i18next";

import { Sermon } from "@/models/models";
import { DocumentIcon, PencilIcon, ChevronIcon } from "@components/Icons";

interface DashboardStatsProps {
  sermons: Sermon[];
}

export default function DashboardStats({ sermons }: DashboardStatsProps) {
  const { t } = useTranslation();
  
  // Calculate stats
  const totalSermons = sermons.length;
  const totalThoughts = sermons.reduce((sum, sermon) => sum + (sermon.thoughts?.length || 0), 0);
  
  // Count sermons with outlines
  const sermonsWithOutlines = sermons.filter(sermon => 
    sermon.outline?.introduction?.length || 
    sermon.outline?.main?.length || 
    sermon.outline?.conclusion?.length
  ).length;
  
  // Get the latest sermon date
  const latestSermonDate = sermons.length > 0 
    ? new Date(Math.max(...sermons.map(s => new Date(s.date).getTime())))
    : null;
    
  // Format the latest sermon date
  const formattedLatestDate = latestSermonDate 
    ? new Intl.DateTimeFormat(undefined, { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      }).format(latestSermonDate)
    : '--';
  
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
      {/* Total Sermons */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-3 sm:p-5">
        <div className="flex items-center">
          <div className="rounded-full bg-blue-100 dark:bg-blue-900 p-2 sm:p-3 mr-3 sm:mr-4 flex-shrink-0">
            <DocumentIcon className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-grow">
            <h3 className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('dashboard.stats.totalSermons')}
            </h3>
            <p className="text-xl sm:text-2xl font-bold">
              {totalSermons}
            </p>
          </div>
        </div>
      </div>
      
      {/* Total Thoughts */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-3 sm:p-5">
        <div className="flex items-center">
          <div className="rounded-full bg-purple-100 dark:bg-purple-900 p-2 sm:p-3 mr-3 sm:mr-4 flex-shrink-0">
            <PencilIcon className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="flex-grow">
            <h3 className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('dashboard.stats.totalThoughts')}
            </h3>
            <p className="text-xl sm:text-2xl font-bold">
              {totalThoughts}
            </p>
          </div>
        </div>
      </div>
      
      {/* Sermons with Outlines */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-3 sm:p-5">
        <div className="flex items-center">
          <div className="rounded-full bg-green-100 dark:bg-green-900 p-2 sm:p-3 mr-3 sm:mr-4 flex-shrink-0">
            <ChevronIcon direction="right" className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-grow">
            <h3 className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 line-clamp-1">
              {t('dashboard.stats.withOutlines')}
            </h3>
            <p className="text-xl sm:text-2xl font-bold">
              {sermonsWithOutlines}
            </p>
          </div>
        </div>
      </div>
      
      {/* Latest Sermon */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-3 sm:p-5">
        <div className="flex items-center">
          <div className="rounded-full bg-yellow-100 dark:bg-yellow-900 p-2 sm:p-3 mr-3 sm:mr-4 flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-grow">
            <h3 className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 line-clamp-1">
              {t('dashboard.stats.latestSermon')}
            </h3>
            <p className="text-sm sm:text-xl font-bold truncate">
              {formattedLatestDate}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
} 
