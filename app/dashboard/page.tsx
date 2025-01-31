import { getSermons } from '@/services/sermon.service';
import Link from "next/link";

export default async function DashboardPage() {
  const sermons = await getSermons();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Мои проповеди
        </h1>
        <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
          Новая запись
        </button>
      </div>
      
      {/* Sermons List */}
      <div className="grid gap-4">
        {sermons.map((sermon, index) => (
          <Link key={index} href={`/sermons/${sermon.id}`}>
            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-center">
                <div className="mr-8">
                  <h3 className="text-lg font-semibold mb-2">{sermon.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2 break-words">
                    {sermon.verse}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{sermon.date}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button className="w-full px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-md">
                    TXT
                  </button>
                  <button className="w-full px-3 py-1.5 text-sm bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 rounded-md">
                    PDF
                  </button>
                  <button className="w-full px-3 py-1.5 text-sm bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 rounded-md">
                    Word
                  </button>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
} 