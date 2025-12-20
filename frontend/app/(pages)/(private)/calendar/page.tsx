"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { useCalendarSermons } from "@/hooks/useCalendarSermons";
import CalendarHeader from "@/components/calendar/CalendarHeader";
import PreachCalendar from "@/components/calendar/PreachCalendar";
import DateEventList from "@/components/calendar/DateEventList";
import AgendaView from "@/components/calendar/AgendaView";
import AnalyticsSection from "@/components/calendar/AnalyticsSection";
import LegacyDataWarning from "@/components/calendar/LegacyDataWarning";
import { DashboardStatsSkeleton } from "@/components/skeletons/DashboardStatsSkeleton";
import PreachDateModal from "@/components/calendar/PreachDateModal";
import { Sermon, PreachDate } from "@/models/models";
import * as preachDatesService from "@/services/preachDates.service";

export default function CalendarPage() {
    const { t } = useTranslation();
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
    const [view, setView] = useState<'month' | 'agenda' | 'analytics'>('month');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedSermon, setSelectedSermon] = useState<(Sermon & { currentPreachDate?: PreachDate }) | null>(null);

    // We fetch a wide range for the calendar, or just let the hook handle it
    // For now, let's fetch everything the hook provides
    const { sermons, sermonsByDate, pendingSermons, isLoading, error, refetch } = useCalendarSermons();

    const selectedMonth = format(currentMonth, 'yyyy-MM');
    const sermonsForSelectedMonth = Object.entries(sermonsByDate)
        .filter(([dateStr]) => dateStr.startsWith(selectedMonth))
        .flatMap(([, sermons]) => sermons);

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
            await preachDatesService.addPreachDate(selectedSermon.id, data);
            setIsModalOpen(false);
            setSelectedSermon(null);
            refetch();
        } catch (err) {
            console.error("Failed to save preach date:", err);
            // Error handling is inside the modal (isSaving state + throw in service)
            // But we might want to show a toast here if we had a toast system
            throw err;
        }
    };

    if (error) {
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

            {!isLoading && (
                <LegacyDataWarning
                    pendingSermons={pendingSermons}
                    onAddDate={handleAddDate}
                />
            )}

            {view === 'month' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1">
                        {isLoading ? (
                            <div className="h-[400px] bg-white dark:bg-gray-800 rounded-xl animate-pulse border border-gray-200 dark:border-gray-700" />
                        ) : (
                            <PreachCalendar
                                sermonsByDate={sermonsByDate}
                                selectedDate={selectedDate}
                                onDateSelect={setSelectedDate}
                                currentMonth={currentMonth}
                                onMonthChange={handleMonthChange}
                            />
                        )}

                        {/* Analytics Mini-Summary could go here */}
                        {!isLoading && (
                            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800/50">
                                <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
                                    {t('calendar.analytics.quickSummary')}
                                </h3>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-blue-600 dark:text-blue-400">{t('calendar.analytics.totalPreachings')}</span>
                                        <span className="font-bold text-blue-900 dark:text-blue-100">
                                            {sermons.flatMap(s => s.preachDates || []).length}
                                        </span>
                                    </div>
                                    {pendingSermons.length > 0 && (
                                        <div className="flex justify-between text-xs">
                                            <span className="text-amber-600 dark:text-amber-400">{t('calendar.analytics.pendingDateEntry')}</span>
                                            <span className="font-bold text-amber-900 dark:text-amber-100">
                                                {pendingSermons.length}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-2">
                        {isLoading ? (
                            <div className="space-y-4">
                                {[1, 2].map(i => (
                                    <div key={i} className="h-32 bg-white dark:bg-gray-800 rounded-xl animate-pulse border border-gray-200 dark:border-gray-700" />
                                ))}
                            </div>
                        ) : (
                            <DateEventList
                                month={currentMonth}
                                sermons={sermonsForSelectedMonth}
                            />
                        )}
                    </div>
                </div>
            ) : view === 'agenda' ? (
                <AgendaView sermons={sermons} />
            ) : (
                <AnalyticsSection sermonsByDate={sermonsByDate} sermons={sermons} />
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
                    date: new Date().toISOString().split('T')[0],
                    church: { id: '', name: '', city: '' },
                    createdAt: new Date().toISOString()
                } : undefined)}
            />
        </div>
    );
}
