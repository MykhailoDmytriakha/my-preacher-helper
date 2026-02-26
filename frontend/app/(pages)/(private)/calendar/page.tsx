"use client";

import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import AgendaView from "@/components/calendar/AgendaView";
import AnalyticsSection from "@/components/calendar/AnalyticsSection";
import CalendarHeader from "@/components/calendar/CalendarHeader";
import DateEventList from "@/components/calendar/DateEventList";
import LegacyDataWarning from "@/components/calendar/LegacyDataWarning";
import PreachCalendar from "@/components/calendar/PreachCalendar";
import PreachDateModal from "@/components/calendar/PreachDateModal";
import { useCalendarGroups } from "@/hooks/useCalendarGroups";
import { useCalendarSermons } from "@/hooks/useCalendarSermons";
import { useSeries } from "@/hooks/useSeries";
import { Sermon, PreachDate } from "@/models/models";
import { useAuth } from "@/providers/AuthProvider";
import * as preachDatesService from "@/services/preachDates.service";
import { getTodayDateOnlyKey, toDateOnlyKey } from "@/utils/dateOnly";
import { debugLog } from "@/utils/debugMode";
import {
    getEffectiveIsPreached,
    getEffectivePreachDateStatus
} from "@/utils/preachDateStatus";

export default function CalendarPage() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
    const [view, setView] = useState<'month' | 'agenda' | 'analytics'>('month');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedSermon, setSelectedSermon] = useState<(Sermon & { currentPreachDate?: PreachDate }) | null>(null);
    const [filterSermons, setFilterSermons] = useState(true);
    const [filterGroups, setFilterGroups] = useState(true);

    // We fetch a wide range for the calendar, or just let the hook handle it
    // For now, let's fetch everything the hook provides
    const { sermons, pendingSermons, isLoading, error, refetch } = useCalendarSermons();
    const {
        groups,
        groupsByDate,
        isLoading: groupsLoading,
        error: groupsError,
        refetch: refetchGroups
    } = useCalendarGroups();

    // Fetch series data for series color indicators
    const { series: allSeries } = useSeries(user?.uid || null);

    const normalizedSermonsByDate = useMemo(
        () => sermons.reduce((acc, sermon) => {
            (sermon.preachDates || []).forEach((preachDate) => {
                const dateKey = toDateOnlyKey(preachDate.date);
                if (!dateKey) {
                    return;
                }

                if (!acc[dateKey]) {
                    acc[dateKey] = [];
                }

                acc[dateKey].push({
                    ...sermon,
                    currentPreachDate: {
                        ...preachDate,
                        date: dateKey
                    }
                });
            });
            return acc;
        }, {} as Record<string, (Sermon & { currentPreachDate?: PreachDate })[]>),
        [sermons]
    );

    const selectedMonth = format(currentMonth, 'yyyy-MM');
    const sermonsForSelectedMonth = useMemo(
        () => filterSermons
            ? Object.entries(normalizedSermonsByDate)
                .filter(([dateStr]) => dateStr.startsWith(selectedMonth))
                .flatMap(([, sermons]) => sermons)
            : [],
        [filterSermons, normalizedSermonsByDate, selectedMonth]
    );
    const groupsForSelectedMonth = useMemo(
        () => filterGroups
            ? Object.entries(groupsByDate)
                .filter(([dateStr]) => dateStr.startsWith(selectedMonth))
                .flatMap(([, groupsList]) => groupsList)
            : [],
        [filterGroups, groupsByDate, selectedMonth]
    );

    const calendarEventsByDate = useMemo(
        () => ({
            ...normalizedSermonsByDate,
            ...Object.fromEntries(
                Object.entries(groupsByDate).map(([date, groupEvents]) => [
                    date,
                    [...(normalizedSermonsByDate[date] || []), ...groupEvents]
                ])
            )
        }),
        [normalizedSermonsByDate, groupsByDate]
    );
    const sermonStatusByDate = sermons.reduce((acc, sermon) => {
        (sermon.preachDates || []).forEach((preachDate) => {
            const dateKey = toDateOnlyKey(preachDate.date);
            if (!dateKey) {
                return;
            }
            if (!acc[dateKey]) {
                acc[dateKey] = { planned: 0, preached: 0 };
            }
            const status = getEffectivePreachDateStatus(preachDate, Boolean(sermon.isPreached));
            acc[dateKey][status] += 1;
        });
        return acc;
    }, {} as Record<string, { planned: number; preached: number }>);
    const { preachedSermonsCount, plannedSermonsCount } = Object.entries(sermonStatusByDate).reduce(
        (acc, [dateKey, statusCounts]) => {
            if (!dateKey.startsWith(selectedMonth)) {
                return acc;
            }
            return {
                preachedSermonsCount: acc.preachedSermonsCount + statusCounts.preached,
                plannedSermonsCount: acc.plannedSermonsCount + statusCounts.planned
            };
        },
        { preachedSermonsCount: 0, plannedSermonsCount: 0 }
    );

    useEffect(() => {
        debugLog('[calendar][page] normalized pipelines', {
            selectedMonth,
            selectedDate: format(selectedDate, 'yyyy-MM-dd'),
            normalizedSermonsByDateKeys: Object.keys(normalizedSermonsByDate).sort(),
            sermonStatusByDateKeys: Object.keys(sermonStatusByDate).sort(),
            calendarEventKeys: Object.keys(calendarEventsByDate).sort(),
            sermonsForSelectedMonthCount: sermonsForSelectedMonth.length,
            sermonsForSelectedMonthRawDates: sermonsForSelectedMonth.map((sermon) => ({
                sermonId: sermon.id,
                currentPreachDate: sermon.currentPreachDate?.date,
                allPreachDates: (sermon.preachDates || []).map((preachDate) => preachDate.date)
            })),
            preachedSermonsCount,
            plannedSermonsCount,
        });
    }, [
        selectedMonth,
        selectedDate,
        normalizedSermonsByDate,
        sermonStatusByDate,
        calendarEventsByDate,
        sermonsForSelectedMonth,
        preachedSermonsCount,
        plannedSermonsCount,
    ]);

    const handleAddDate = (sermon: Sermon & { currentPreachDate?: PreachDate }) => {
        setSelectedSermon(sermon);
        setIsModalOpen(true);
    };

    const handleMonthChange = (month: Date) => {
        setCurrentMonth(month);
    };

    const handleGoToToday = () => {
        const today = new Date();
        setCurrentMonth(today);
        setSelectedDate(today);
    };

    const handleSaveDate = async (data: Omit<PreachDate, 'id' | 'createdAt'>) => {
        if (!selectedSermon) return;
        try {
            await preachDatesService.addPreachDate(selectedSermon.id, {
                ...data,
                status: getEffectiveIsPreached(selectedSermon) ? 'preached' : (data.status || 'planned')
            });
            setIsModalOpen(false);
            setSelectedSermon(null);
            await Promise.all([refetch(), refetchGroups()]);
        } catch (err) {
            console.error("Failed to save preach date:", err);
            // Error handling is inside the modal (isSaving state + throw in service)
            // But we might want to show a toast here if we had a toast system
            throw err;
        }
    };

    if (error || groupsError) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <h2 className="text-xl font-semibold text-red-600">Error loading calendar</h2>
                    <p className="text-gray-500">Please try again later.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <CalendarHeader
                view={view}
                onViewChange={setView}
                currentMonth={currentMonth}
                onGoToToday={handleGoToToday}
            />

            {!(isLoading || groupsLoading) && (
                <LegacyDataWarning
                    pendingSermons={pendingSermons}
                    onAddDate={handleAddDate}
                />
            )}

            {view === 'month' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1">
                        {(isLoading || groupsLoading) ? (
                            <div className="h-[400px] bg-white dark:bg-gray-800 rounded-xl animate-pulse border border-gray-200 dark:border-gray-700" />
                        ) : (
                            <PreachCalendar
                                eventsByDate={calendarEventsByDate}
                                sermonStatusByDate={sermonStatusByDate}
                                selectedDate={selectedDate}
                                onDateSelect={setSelectedDate}
                                currentMonth={currentMonth}
                                onMonthChange={handleMonthChange}
                                filterSermons={filterSermons}
                                filterGroups={filterGroups}
                                onToggleSermons={() => setFilterSermons(!filterSermons)}
                                onToggleGroups={() => setFilterGroups(!filterGroups)}
                            />
                        )}

                        {/* Analytics Mini-Summary could go here */}
                        {!(isLoading || groupsLoading) && (
                            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800/50">
                                <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
                                    {t('calendar.analytics.quickSummary')}
                                </h3>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-blue-600 dark:text-blue-400">{t('calendar.analytics.totalPreachings')}</span>
                                        <span className="font-bold text-blue-900 dark:text-blue-100">
                                            {preachedSermonsCount}
                                        </span>
                                    </div>
                                    {plannedSermonsCount > 0 && (
                                        <div className="flex justify-between text-xs">
                                            <span className="text-amber-600 dark:text-amber-400">
                                                {t('calendar.analytics.plannedPreachings', { defaultValue: 'Planned preachings' })}
                                            </span>
                                            <span className="font-bold text-amber-900 dark:text-amber-100">
                                                {plannedSermonsCount}
                                            </span>
                                        </div>
                                    )}
                                    {pendingSermons.length > 0 && (
                                        <div className="flex justify-between text-xs">
                                            <span className="text-amber-600 dark:text-amber-400">{t('calendar.analytics.pendingDateEntry')}</span>
                                            <span className="font-bold text-amber-900 dark:text-amber-100">
                                                {pendingSermons.length}
                                            </span>
                                        </div>
                                    )}
                                    {groupsForSelectedMonth.length > 0 && (
                                        <div className="flex justify-between text-xs">
                                            <span className="text-emerald-600 dark:text-emerald-400">
                                                {t('calendar.analytics.totalGroups', { defaultValue: 'Группы' })}
                                            </span>
                                            <span className="font-bold text-emerald-900 dark:text-emerald-100">
                                                {groupsForSelectedMonth.length}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-2">
                        {(isLoading || groupsLoading) ? (
                            <div className="space-y-4">
                                {[1, 2].map(i => (
                                    <div key={i} className="h-32 bg-white dark:bg-gray-800 rounded-xl animate-pulse border border-gray-200 dark:border-gray-700" />
                                ))}
                            </div>
                        ) : (
                            <DateEventList
                                month={currentMonth}
                                sermons={sermonsForSelectedMonth}
                                groups={groupsForSelectedMonth}
                                series={allSeries}
                            />
                        )}
                    </div>
                </div>
            ) : view === 'agenda' ? (
                <AgendaView sermons={sermons} groups={groups} series={allSeries} />
            ) : (
                <AnalyticsSection sermonsByDate={normalizedSermonsByDate} />
            )}

            <PreachDateModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setSelectedSermon(null);
                }}
                onSave={handleSaveDate}
                initialData={selectedSermon?.currentPreachDate || (selectedSermon ? {
                    id: '',
                    date: getTodayDateOnlyKey(),
                    status: getEffectiveIsPreached(selectedSermon) ? 'preached' : 'planned',
                    church: { id: '', name: '', city: '' },
                    createdAt: new Date().toISOString()
                } : undefined)}
                defaultStatus={selectedSermon && getEffectiveIsPreached(selectedSermon) ? 'preached' : 'planned'}
            />
        </div>
    );
}
