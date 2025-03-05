"use client";

import { useEffect, useState } from "react";
import { getSermons } from "@services/sermon.service";
import { auth } from "@services/firebaseAuth.service";
import AddSermonModal from "@components/AddSermonModal";
import { Sermon } from "@/models/models";
import SermonList from "@components/dashboard/SermonList";
import DashboardStats from "@components/dashboard/DashboardStats";
import { useTranslation } from "react-i18next";
import { ChevronIcon } from "@components/Icons";

export default function DashboardPage() {
  const { t } = useTranslation();
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<"newest" | "oldest" | "alphabetical">("newest");
  
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

  const sortedAndFilteredSermons = () => {
    // First filter based on search query
    const filtered = searchQuery
      ? sermons.filter(sermon => 
          sermon.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          sermon.verse.toLowerCase().includes(searchQuery.toLowerCase()))
      : sermons;
    
    // Then sort based on selected option
    return [...filtered].sort((a, b) => {
      switch (sortOption) {
        case "newest":
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        case "oldest":
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        case "alphabetical":
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          {t('dashboard.mySermons')}
        </h1>
        <AddSermonModal
          onNewSermonCreated={(newSermon: Sermon) =>
            setSermons((prevSermons) => [newSermon, ...prevSermons])
          }
        />
      </div>
      
      {/* Dashboard Stats */}
      {sermons.length > 0 && (
        <DashboardStats sermons={sermons} />
      )}
      
      {/* Search and Sort Options */}
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
        <div className="relative flex-grow">
          <input
            type="text"
            placeholder={t('dashboard.searchSermons')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full p-3 pr-10 border rounded-md border-gray-300 dark:border-gray-700 
                      dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          )}
        </div>
        
        <div className="relative min-w-[180px]">
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as "newest" | "oldest" | "alphabetical")}
            className="appearance-none w-full p-3 pr-10 border rounded-md border-gray-300 
                      dark:border-gray-700 dark:bg-gray-800 bg-white dark:bg-gray-800
                      focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="newest">{t('dashboard.newest')}</option>
            <option value="oldest">{t('dashboard.oldest')}</option>
            <option value="alphabetical">{t('dashboard.alphabetical')}</option>
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
            <ChevronIcon direction="down" className="w-5 h-5 text-gray-500" />
          </div>
        </div>
      </div>
      
      {/* Empty State */}
      {sermons.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="text-xl font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('dashboard.noSermons')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t('dashboard.createFirstSermon')}
          </p>
        </div>
      ) : sortedAndFilteredSermons().length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="text-xl font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('dashboard.noSearchResults')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {t('dashboard.tryDifferentSearch')}
          </p>
        </div>
      ) : (
        <SermonList 
          sermons={sortedAndFilteredSermons()} 
          onDelete={(id: string) => setSermons((prev) => prev.filter((s) => s.id !== id))}
          onUpdate={(updatedSermon: Sermon) => setSermons(prev => 
            prev.map(s => s.id === updatedSermon.id ? updatedSermon : s)
          )} 
        />
      )}
    </div>
  );
}
