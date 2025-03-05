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
    <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
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
                 border border-gray-200 dark:border-gray-700 h-auto relative">
            <Link href={`/sermons/${sermon.id}`} className="flex-grow flex flex-col overflow-hidden">
              <div className="p-5 flex-grow">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold group-hover:text-blue-600 
                     dark:group-hover:text-blue-400 transition-colors line-clamp-2">
                    {sermon.title}
                  </h3>
                  <div className="z-20">
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
                
                {/* Stats row */}
                <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mt-auto">
                  <div className="flex items-center mr-4">
                    <DocumentIcon className="w-4 h-4 mr-1" />
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
              
              {/* Footer */}
              <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-between items-center">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {formattedDate}
                </span>
                <ExportButtons
                  sermonId={sermon.id}
                  orientation="horizontal"
                  getExportContent={() => exportSermonContent(sermon)}
                />
              </div>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
