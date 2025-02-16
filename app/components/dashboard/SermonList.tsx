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
          <div key={sermon.id} className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <Link href={`/sermons/${sermon.id}`} className="flex-grow">
              <div>
                <h3 className="text-lg font-semibold">{sermon.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-2 break-words">
                  {sermon.verse}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {formattedDate}
                </p>
              </div>
            </Link>
            <div className="flex flex-col items-end gap-2">
              <OptionMenu
                sermon={sermon}
                onDelete={(id: string) => onDelete(id)}
                onUpdate={onUpdate}
              />
              <ExportButtons
                sermonId={sermon.id}
                orientation="vertical"
                getExportContent={() => exportSermonContent(sermon)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
