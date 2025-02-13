"use client";

import { useEffect, useState } from "react";
import { getSermons } from "@services/sermon.service";
import { auth } from "@services/firebaseAuth.service";
import Link from "next/link";
import ExportButtons from "@components/ExportButtons";
import AddSermonModal from "@components/AddSermonModal";
import OptionMenu from "@components/OptionMenu";
import { formatDate } from "@utils/dateFormatter";
import { Sermon } from "@/models/models";
import type { Thought } from "@/models/models";
import { exportSermonContent } from "@/utils/exportContent";

export default function DashboardPage() {
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const currentUser = auth.currentUser;
      let uid: string | undefined;
      if (currentUser) {
        uid = currentUser.uid;
      } else {
        try {
          const guestData = localStorage.getItem("guestUser");
          if (guestData) {
            uid = JSON.parse(guestData).uid;
          }
        } catch (error) {
          console.error("Error parsing guestUser from localStorage", error);
        }
      }
      if (uid) {
        const fetchedSermons = await getSermons(uid);
        setSermons(fetchedSermons);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Мои проповеди
        </h1>
        <AddSermonModal
          onNewSermonCreated={(newSermon: Sermon) =>
            setSermons((prevSermons) => [newSermon, ...prevSermons])
          }
        />
      </div>
      
      {/* Sermons List */}
      <div className="grid gap-4">
        {sermons.map((sermon, index) => {
          const formattedDate = formatDate(sermon.date);
          return (
            <Link key={index} href={`/sermons/${sermon.id}`}>
              <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-center">
                  <div className="mr-8">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{sermon.title}</h3>
                      <OptionMenu
                        sermon={sermon}
                        onDelete={(id: string) =>
                          setSermons((prev) => prev.filter((s) => s.id !== id))
                        }
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
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
