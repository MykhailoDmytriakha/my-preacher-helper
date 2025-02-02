import { getSermons } from '@services/api.service';
import Link from "next/link";
import ExportButtons from "@components/ExportButtons";
import AddSermonModal from "@components/AddSermonModal";

export default async function DashboardPage() {
  const sermons = await getSermons();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Мои проповеди
        </h1>
        <AddSermonModal />
      </div>
      
      {/* Sermons List */}
      <div className="grid gap-4">
        {sermons.map((sermon, index) => {
          // Format the sermon date with digits only
          const formattedDate = new Date(sermon.date).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          return (
            <Link key={index} href={`/sermons/${sermon.id}`}>
              <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-center">
                  <div className="mr-8">
                    <h3 className="text-lg font-semibold mb-2">{sermon.title}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mb-2 break-words">
                      {sermon.verse}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {formattedDate}
                    </p>
                  </div>
                  <ExportButtons sermonId={sermon.id} orientation="vertical" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
} 