"use client";

import {
    ChartBarIcon,
    MapPinIcon,
    UserGroupIcon,
    CalendarIcon,
    BookOpenIcon
} from "@heroicons/react/24/outline";
import { format } from "date-fns";
import { enUS, ru, uk } from "date-fns/locale";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { BibleLocale } from "@/(pages)/(private)/studies/bibleData";
import { computeAnalyticsStats } from "@/components/calendar/calendarAnalytics";
import { Sermon } from "@/models/models";

interface AnalyticsSectionProps {
    sermonsByDate: Record<string, Sermon[]>;
}

export default function AnalyticsSection({ sermonsByDate }: AnalyticsSectionProps) {
    const { t, i18n } = useTranslation();
    const sermonsLabel = t('calendar.analytics.sermons', { defaultValue: 'sermons' });
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState<number | 'all'>(currentYear);

    const getDateLocale = () => {
        switch (i18n.language) {
            case 'ru': return ru;
            case 'uk': return uk;
            default: return enUS;
        }
    };

    const availableYears = useMemo(() => {
        const years = new Set<number>();
        Object.keys(sermonsByDate).forEach(dateStr => {
            const year = Number(dateStr.slice(0, 4));
            if (!Number.isNaN(year)) {
                years.add(year);
            }
        });
        years.add(currentYear);
        return Array.from(years).sort((a, b) => b - a);
    }, [sermonsByDate, currentYear]);

    const stats = useMemo(() => computeAnalyticsStats({
        sermonsByDate,
        selectedYear,
        locale: i18n.language,
    }), [sermonsByDate, i18n.language, selectedYear]);

    const formatMonthLabel = (monthKey?: string) => {
        if (!monthKey) return 'N/A';
        const monthDate = new Date(`${monthKey}-01`);
        if (Number.isNaN(monthDate.getTime())) return monthKey;
        return format(monthDate, 'MMMM yyyy', { locale: getDateLocale() }).replace(/^./, str => str.toUpperCase());
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {t('calendar.analytics.title')}
                </h2>
                <div className="flex items-center gap-2">
                    <label
                        htmlFor="calendar-analytics-year"
                        className="text-sm font-medium text-gray-600 dark:text-gray-300"
                    >
                        {t('calendar.analytics.year')}
                    </label>
                    <select
                        id="calendar-analytics-year"
                        value={selectedYear}
                        onChange={(event) => {
                            const value = event.target.value;
                            setSelectedYear(value === 'all' ? 'all' : Number(value));
                        }}
                        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="all">{t('calendar.analytics.allYears')}</option>
                        {availableYears.map(year => (
                            <option key={year} value={year}>
                                {year}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

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
                        {formatMonthLabel(stats.busiestMonthLabel)}
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
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700">
                        {stats.topChurches.map(([name, count]) => (
                            <div key={name} className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-bold text-gray-500 shrink-0">
                                        {count}
                                    </div>
                                    <span className="text-sm text-gray-700 dark:text-gray-300 font-medium truncate">{name}</span>
                                </div>
                                <div className="h-2.5 w-40 md:w-64 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden shrink-0">
                                    <div
                                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                                        style={{ width: `${stats.churchMax > 0 ? (count / stats.churchMax) * 100 : 0}%` }}
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

                {/* Bible Books Distribution */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center gap-2">
                        <BookOpenIcon className="w-5 h-5 text-purple-500" />
                        {t('calendar.analytics.bibleBooks', { defaultValue: 'Bible Books Distribution' })}
                    </h3>

                    {/* Old Testament */}
                    <div className="mb-8">
                        <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-4 uppercase tracking-wide">
                            {t('calendar.analytics.oldTestament', { defaultValue: 'Old Testament' })}
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                            {stats.oldTestamentBooks.map((book) => {
                                const count = stats.bibleBookCounts[book.id] || 0;
                                const intensity = stats.bibleBookMax > 0 ? (count / stats.bibleBookMax) * 100 : 0;

                                return (
                                    <div
                                        key={book.id}
                                        className="relative p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-500 transition-colors cursor-pointer group"
                                        style={{
                                            backgroundColor: count > 0
                                                ? `rgba(168, 85, 247, ${intensity / 100 * 0.2})`
                                                : 'transparent'
                                        }}
                                        title={`${book.names.en} (${book.names.ru}): ${count} ${sermonsLabel}`}
                                    >
                                        <div className="text-center">
                                            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                                                {book.abbrev[i18n.language as BibleLocale] || book.abbrev.en}
                                            </div>
                                            {count > 0 && (
                                                <div className="text-xs font-bold text-purple-600 dark:text-purple-400 mt-1">
                                                    {count}
                                                </div>
                                            )}
                                        </div>
                                        {count > 0 && (
                                            <div
                                                className="absolute bottom-0 left-0 right-0 h-1 bg-purple-500 rounded-b-lg opacity-60"
                                                style={{ width: `${intensity}%` }}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* New Testament */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-4 uppercase tracking-wide">
                            {t('calendar.analytics.newTestament', { defaultValue: 'New Testament' })}
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                            {stats.newTestamentBooks.map((book) => {
                                const count = stats.bibleBookCounts[book.id] || 0;
                                const intensity = stats.bibleBookMax > 0 ? (count / stats.bibleBookMax) * 100 : 0;

                                return (
                                    <div
                                        key={book.id}
                                        className="relative p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-500 transition-colors cursor-pointer group"
                                        style={{
                                            backgroundColor: count > 0
                                                ? `rgba(168, 85, 247, ${intensity / 100 * 0.2})`
                                                : 'transparent'
                                        }}
                                        title={`${book.names.en} (${book.names.ru}): ${count} ${sermonsLabel}`}
                                    >
                                        <div className="text-center">
                                            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                                                {book.abbrev[i18n.language as BibleLocale] || book.abbrev.en}
                                            </div>
                                            {count > 0 && (
                                                <div className="text-xs font-bold text-purple-600 dark:text-purple-400 mt-1">
                                                    {count}
                                                </div>
                                            )}
                                        </div>
                                        {count > 0 && (
                                            <div
                                                className="absolute bottom-0 left-0 right-0 h-1 bg-purple-500 rounded-b-lg opacity-60"
                                                style={{ width: `${intensity}%` }}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
                        <div className="flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-400">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-600 rounded"></div>
                                <span>{t('calendar.analytics.noSermons', { defaultValue: 'No sermons' })}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-purple-500 rounded"></div>
                                <span>{t('calendar.analytics.mostSermons', { defaultValue: 'Most sermons' })}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Monthly Activity */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm lg:col-span-2">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center gap-2">
                        <ChartBarIcon className="w-5 h-5 text-amber-500" />
                        {t('calendar.analytics.monthlyActivity')}
                    </h3>

                    {/* Monthly Activity Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {stats.monthlyActivity.map(({ month, count }) => {
                            const intensity = stats.totalPreachings > 0 ? (count / Math.max(...stats.monthlyActivity.map(m => m.count))) * 100 : 0;
                            const monthDate = new Date(month + '-01');

                            return (
                                <div
                                    key={month}
                                    className="relative p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-amber-300 dark:hover:border-amber-500 transition-colors cursor-pointer group"
                                    style={{
                                        backgroundColor: count > 0
                                            ? `rgba(245, 158, 11, ${intensity / 100 * 0.2})`
                                            : 'transparent'
                                    }}
                                    title={`${format(monthDate, 'MMMM yyyy', { locale: getDateLocale() }).replace(/^./, str => str.toUpperCase())}: ${count} ${sermonsLabel}`}
                                >
                                    <div className="text-center">
                                        <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                                            {format(monthDate, 'MMM yy', { locale: getDateLocale() }).replace('.', '').replace(/^./, str => str.toUpperCase())}
                                        </div>
                                        {count > 0 && (
                                            <div className="text-sm font-bold text-amber-600 dark:text-amber-400 mt-1">
                                                {count}
                                            </div>
                                        )}
                                    </div>
                                    {count > 0 && (
                                        <div
                                            className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500 rounded-b-lg opacity-60"
                                            style={{ width: `${intensity}%` }}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Monthly Activity Legend */}
                    <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
                        <div className="flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-400">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-600 rounded"></div>
                                <span>{t('calendar.analytics.noActivity', { defaultValue: 'No activity' })}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-amber-500 rounded"></div>
                                <span>{t('calendar.analytics.mostActivity', { defaultValue: 'Most activity' })}</span>
                            </div>
                        </div>
                    </div>

                    {stats.monthlyActivity.length === 0 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-4">
                            {t('calendar.analytics.noActivityRecorded', { defaultValue: 'No activity recorded yet' })}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
