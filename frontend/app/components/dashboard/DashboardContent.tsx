import { useTranslation } from "react-i18next";

import SermonCard from "@/components/dashboard/SermonCard";
import { SermonCardSkeleton } from "@/components/skeletons/SermonCardSkeleton";
import { DashboardOptimisticActions, DashboardSermonSyncState } from "@/models/dashboardOptimistic";
import { Sermon, Series } from "@/models/models";
import { ThoughtSnippet } from "@/utils/sermonSearch";

interface DashboardContentProps {
    loading: boolean;
    sermons: Sermon[];
    processedSermons: Sermon[];
    searchSnippetsById: Record<string, ThoughtSnippet[] | undefined>;
    allSeries: Series[];
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    onDeleteSermon: (id: string) => void;
    onUpdateSermon: (sermon: Sermon) => void;
    syncStatesById?: Record<string, DashboardSermonSyncState>;
    optimisticActions?: DashboardOptimisticActions;
}

export default function DashboardContent({
    loading,
    sermons,
    processedSermons,
    searchSnippetsById,
    allSeries,
    searchQuery,
    setSearchQuery,
    onDeleteSermon,
    onUpdateSermon,
    syncStatesById = {},
    optimisticActions
}: DashboardContentProps) {
    const { t } = useTranslation();

    if (loading) {
        return (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <SermonCardSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (sermons.length === 0) {
        return (
            <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                <div className="mx-auto h-12 w-12 text-gray-400">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                </div>
                <h3 className="mt-2 text-lg font-medium text-gray-900 dark:text-gray-100">
                    {t('dashboard.noSermons')}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                    {t('dashboard.createFirstSermon')}
                </p>
            </div>
        );
    }

    if (processedSermons.length === 0) {
        return (
            <div className="text-center py-16">
                <div className="mx-auto h-12 w-12 text-gray-400">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>
                <h3 className="mt-2 text-lg font-medium text-gray-900 dark:text-gray-100">
                    {t('dashboard.noSearchResults')}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {t('dashboard.tryDifferentSearch')}
                </p>
                <button
                    onClick={() => setSearchQuery("")}
                    className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-500"
                >
                    {t('dashboard.clearSearch')}
                </button>
            </div>
        );
    }

    return (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3" data-testid="sermon-grid">
            {processedSermons.map((sermon) => (
                <SermonCard
                    key={sermon.id}
                    sermon={sermon}
                    series={allSeries}
                    onDelete={onDeleteSermon}
                    onUpdate={onUpdateSermon}
                    searchQuery={searchQuery}
                    searchSnippets={searchSnippetsById[sermon.id]}
                    syncState={syncStatesById[sermon.id]}
                    optimisticActions={optimisticActions}
                />
            ))}
        </div>
    );
}
