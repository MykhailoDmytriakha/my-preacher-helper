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
  const [isMobileSearchVisible, setIsMobileSearchVisible] = useState(false);
  
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
    
    // Then sort: prioritize non-preached, then apply selected option
    return [...filtered].sort((a, b) => {
      // Primary sort: Move preached sermons to the bottom
      if (a.isPreached && !b.isPreached) return 1; // a comes after b
      if (!a.isPreached && b.isPreached) return -1; // a comes before b

      // Secondary sort: Apply the user-selected sort option
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
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header with responsive styling */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          {t('dashboard.mySermons')}
        </h1>
        <div className="self-end sm:self-auto">
          <AddSermonModal
            onNewSermonCreated={(newSermon: Sermon) =>
              setSermons((prevSermons) => [newSermon, ...prevSermons])
            }
          />
        </div>
      </div>
      
      {/* Dashboard Stats with responsive grid */}
      {sermons.length > 0 && (
        <div className="overflow-x-auto sm:overflow-visible -mx-4 sm:mx-0">
          <div className="px-4 sm:px-0">
            <DashboardStats sermons={sermons} />
          </div>
        </div>
      )}
      
      {/* Mobile search toggle */}
      <div className="block sm:hidden">
        <button 
          onClick={() => setIsMobileSearchVisible(!isMobileSearchVisible)}
          className="w-full py-2 px-4 bg-gray-100 dark:bg-gray-800 rounded-md flex items-center justify-between"
        >
          <span className="text-gray-700 dark:text-gray-300">
            {isMobileSearchVisible ? t('common.hideSearch') : t('common.showSearch')}
          </span>
          <ChevronIcon 
            direction={isMobileSearchVisible ? "up" : "down"} 
            className="w-5 h-5 text-gray-500" 
          />
        </button>
      </div>

      {/* Search and Sort Options with responsive layout */}
      <div className={`${isMobileSearchVisible || 'hidden sm:flex'} flex-col sm:flex-row gap-4 sm:items-center`}>
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
