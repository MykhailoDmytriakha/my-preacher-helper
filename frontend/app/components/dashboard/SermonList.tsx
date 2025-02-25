"use client";
import Link from "next/link";
import OptionMenu from "@/components/dashboard/OptionMenu";
import ExportButtons from "@components/ExportButtons";
import { formatDate } from "@utils/dateFormatter";
import { Sermon } from "@/models/models";
import { exportSermonContent } from "@/utils/exportContent";

interface SermonListProps {
  sermons: Sermon[];
  onDelete: (id: string) => void;
  onUpdate: (updatedSermon: Sermon) => void;
}

export default function SermonList({ sermons, onDelete, onUpdate }: SermonListProps) {
  return (
    <div className="grid gap-4">
      {sermons.map((sermon) => {
        const formattedDate = formatDate(sermon.date);
        return (
          <div key={sermon.id} className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <Link href={`/sermons/${sermon.id}`}> 
              <div className="flex justify-between items-center">
                <div className="mr-8">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">{sermon.title}</h3>
                    <OptionMenu
                      sermon={sermon}
                      onDelete={(id: string) => onDelete(id)}
                      onUpdate={onUpdate}
                    />
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2 break-words">
                    {sermon.verse}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {formattedDate}
                  </p>
                </div>
                <ExportButtons
                  sermonId={sermon.id}
                  orientation="vertical"
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
