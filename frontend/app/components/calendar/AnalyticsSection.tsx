"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Sermon, PreachDate } from "@/models/models";
import {
    ChartBarIcon,
    MapPinIcon,
    UserGroupIcon,
    CheckBadgeIcon,
    CalendarIcon,
    BookOpenIcon
} from "@heroicons/react/24/outline";

interface AnalyticsSectionProps {
    sermonsByDate: Record<string, Sermon[]>;
    sermons: Sermon[];
}

export default function AnalyticsSection({ sermonsByDate, sermons }: AnalyticsSectionProps) {
    const { t } = useTranslation();

    const stats = useMemo(() => {
        const allPreachDates: { pd: PreachDate, sermon: Sermon }[] = [];

        Object.entries(sermonsByDate).forEach(([dateStr, sermonsForDate]) => {
            sermonsForDate.forEach(sermon => {
                const pd = sermon.preachDates?.find(p => p.date === dateStr);
                if (pd) {
                    allPreachDates.push({ pd, sermon });
                }
            });
        });

        const totalPreachings = allPreachDates.length;

        const churchCounts: Record<string, number> = {};
        const monthCounts: Record<string, number> = {};
        const topicCounts: Record<string, number> = {};

        let totalPrepDays = 0;
        let preachingsWithDates = 0;

        allPreachDates.forEach(({ pd, sermon }) => {
            // Church counts
            const churchKey = `${pd.church.name}${pd.church.city ? `, ${pd.church.city}` : ''}`;
            churchCounts[churchKey] = (churchCounts[churchKey] || 0) + 1;


            // Month counts
            const monthKey = pd.date.substring(0, 7); // YYYY-MM
            monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;

            // Topic counts (from title/verse)
            const topic = sermon.verse.split(' ')[0] || 'Unknown';
            topicCounts[topic] = (topicCounts[topic] || 0) + 1;

            // Prep time calculation
            if (sermon.date && pd.date) {
                const start = new Date(sermon.date).getTime();
                const end = new Date(pd.date).getTime();
                const diffDays = Math.max(0, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
                totalPrepDays += diffDays;
                preachingsWithDates++;
            }
        });

        const topChurches = Object.entries(churchCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const topTopics = Object.entries(topicCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const busiestMonth = Object.entries(monthCounts)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

        const avgPrepTime = preachingsWithDates > 0 ? Math.round(totalPrepDays / preachingsWithDates) : 0;

        return {
            totalPreachings,
            topChurches,
            avgPrepTime,
            topTopics,
            monthlyActivity: Object.entries(monthCounts)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([month, count]) => ({ month, count }))
        };
    }, [sermonsByDate]);

    return (
        <div className="space-y-8">
            {/* Top Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                            <CalendarIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            {t('calendar.analytics.totalPreachings')}
                        </h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                        {stats.totalPreachings}
                    </p>
                </div>

                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                            <ChartBarIcon className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            {t('calendar.analytics.avgPrepTime', { defaultValue: 'Avg Prep Time' })}
                        </h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                        {stats.avgPrepTime} <span className="text-sm font-normal text-gray-500">days</span>
                    </p>
                </div>

                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                            <MapPinIcon className="w-6 h-6 text-green-600 dark:text-green-400" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            {t('calendar.analytics.uniqueChurches')}
                        </h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                        {stats.topChurches.length}
                    </p>
                </div>

                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                            <MapPinIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            {t('calendar.analytics.busiestMonth', { defaultValue: 'Busiest Month' })}
                        </h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                        {stats.monthlyActivity.sort((a, b) => b.count - a.count)[0]?.month || 'N/A'}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Top Churches */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center gap-2">
                        <UserGroupIcon className="w-5 h-5 text-blue-500" />
                        {t('calendar.analytics.topChurches')}
                    </h3>
                    <div className="space-y-4">
                        {stats.topChurches.map(([name, count]) => (
                            <div key={name} className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-bold text-gray-500">
                                        {count}
                                    </div>
                                    <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{name}</span>
                                </div>
                                <div className="h-2 w-24 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500"
                                        style={{ width: `${(count / stats.totalPreachings) * 100}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                        {stats.topChurches.length === 0 && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-4">
                                No data available yet
                            </p>
                        )}
                    </div>
                </div>

                {/* Top Topics */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center gap-2">
                        <BookOpenIcon className="w-5 h-5 text-purple-500" />
                        {t('calendar.analytics.topTopics', { defaultValue: 'Top Books/Topics' })}
                    </h3>
                    <div className="space-y-4">
                        {stats.topTopics.map(([topic, count]) => (
                            <div key={topic} className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-bold text-gray-500">
                                        {count}
                                    </div>
                                    <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{topic}</span>
                                </div>
                                <div className="h-2 w-24 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-purple-500"
                                        style={{ width: `${(count / stats.totalPreachings) * 100}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                        {stats.topTopics.length === 0 && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-4">
                                No data available yet
                            </p>
                        )}
                    </div>
                </div>

                {/* Monthly Activity */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm lg:col-span-2">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center gap-2">
                        <ChartBarIcon className="w-5 h-5 text-amber-500" />
                        {t('calendar.analytics.monthlyActivity')}
                    </h3>
                    <div className="space-y-4">
                        {stats.monthlyActivity.map(({ month, count }) => (
                            <div key={month} className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600 dark:text-gray-400 font-medium">
                                        {format(new Date(month + '-01'), 'MMMM yyyy')}
                                    </span>
                                    <span className="font-bold text-gray-900 dark:text-gray-100">{count}</span>
                                </div>
                                <div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-amber-500 transition-all duration-500"
                                        style={{ width: `${stats.totalPreachings > 0 ? (count / Math.max(...stats.monthlyActivity.map(m => m.count))) * 100 : 0}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                        {stats.monthlyActivity.length === 0 && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-4">
                                No activity recorded yet
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
