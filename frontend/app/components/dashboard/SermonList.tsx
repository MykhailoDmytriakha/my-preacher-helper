"use client";
import Link from "next/link";
import OptionMenu from "@/components/dashboard/OptionMenu";
import ExportButtons from "@components/ExportButtons";
import { formatDate } from "@utils/dateFormatter";
import { Sermon } from "@/models/models";
import { exportSermonContent } from "@/utils/exportContent";
import { DocumentIcon } from "@components/Icons";
import { useTranslation } from "react-i18next";

interface SermonListProps {
  sermons: Sermon[];
  onDelete: (id: string) => void;
  onUpdate: (updatedSermon: Sermon) => void;
}

export default function SermonList({ sermons, onDelete, onUpdate }: SermonListProps) {
  const { t } = useTranslation();
  
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {sermons.map((sermon) => {
        const formattedDate = formatDate(sermon.date);
        // Count the thoughts for this sermon
        const thoughtCount = sermon.thoughts?.length || 0;
        // Check if sermon has outline structure
        const hasOutline = sermon.outline?.introduction?.length || 
                         sermon.outline?.main?.length || 
                         sermon.outline?.conclusion?.length;
        
        return (
          <div key={sermon.id} className="group flex flex-col bg-white dark:bg-gray-800 
                 rounded-lg shadow hover:shadow-lg transition-shadow duration-300 
                 border border-gray-200 dark:border-gray-700 h-full relative">
            <Link href={`/sermons/${sermon.id}`} className="flex-grow flex flex-col overflow-hidden">
              <div className="p-4 sm:p-5 flex-grow">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="text-base sm:text-lg font-semibold group-hover:text-blue-600 
                     dark:group-hover:text-blue-400 transition-colors line-clamp-2">
                    {sermon.title}
                  </h3>
                  <div className="z-20 flex-shrink-0">
                    <OptionMenu
                      sermon={sermon}
                      onDelete={(id: string) => onDelete(id)}
                      onUpdate={onUpdate}
                    />
                  </div>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 break-words whitespace-pre-line">
                  {sermon.verse}
                </p>
                
                {/* Stats row with better mobile layout */}
                <div className="flex flex-wrap items-center text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-auto gap-y-2">
                  <div className="flex items-center mr-4">
                    <DocumentIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
                    <span>{thoughtCount} {thoughtCount === 1 ? t('dashboard.thought') : t('dashboard.thoughts')}</span>
                  </div>
                  {hasOutline && (
                    <div className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900 
                         text-green-800 dark:text-green-200 text-xs font-medium">
                      {t('dashboard.hasOutline')}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Footer with responsive design */}
              <div className="p-3 sm:p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                  {formattedDate}
                </span>
                <ExportButtons
                  sermonId={sermon.id}
                  orientation="horizontal"
                  getExportContent={() => exportSermonContent(sermon)}
                  className="scale-90 sm:scale-100 origin-top-left sm:origin-center"
                />
              </div>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
