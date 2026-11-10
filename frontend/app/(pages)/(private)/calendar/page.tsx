"use client";

import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";

import AgendaView from "@/components/calendar/AgendaView";
import AnalyticsSection from "@/components/calendar/AnalyticsSection";
import CalendarHeader from "@/components/calendar/CalendarHeader";
import { CalendarKindFilters } from "@/components/calendar/CalendarKindFilters";
import { allKindsShown, CALENDAR_KIND_STYLE } from "@/components/calendar/calendarKinds";
import DateEventList from "@/components/calendar/DateEventList";
import { EnginePreachDateModal } from "@/components/calendar/EnginePreachDateModal";
import LegacyDataWarning from "@/components/calendar/LegacyDataWarning";
import PreachCalendar from "@/components/calendar/PreachCalendar";
import { ListReadFeedback } from '@/components/ListReadFeedback';
import { useCalendarCouncils } from "@/hooks/useCalendarCouncils";
import { useCalendarGroups } from "@/hooks/useCalendarGroups";
import { useCalendarNotes } from "@/hooks/useCalendarNotes";
import { useCalendarPrayers } from "@/hooks/useCalendarPrayers";
import { useCalendarSermons } from "@/hooks/useCalendarSermons";
import { useSeries } from "@/hooks/useSeries";
import { Sermon, PreachDate } from "@/models/models";
import { useAuth } from "@/providers/AuthProvider";
import {
    CALENDAR_KINDS,
    countByKind,
    entriesInMonth,
    groupEntries,
    kindsByDate,
    sermonEntries,
    type CalendarKind
} from "@/utils/calendarEntries";
import { toDateOnlyKey } from "@/utils/dateOnly";
import { debugLog } from "@/utils/debugMode";
import { listReadState, type ListReadSource } from '@/utils/listReadState';
import {
    getEffectiveIsPreached,
    getEffectivePreachDateStatus
} from "@/utils/preachDateStatus";
import { useTranslation } from "@locales/useTranslation";

export default function CalendarPage() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
    const [view, setView] = useState<'month' | 'agenda' | 'analytics'>('month');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedSermon, setSelectedSermon] = useState<(Sermon & { currentPreachDate?: PreachDate }) | null>(null);
    const [shown, setShown] = useState<Record<CalendarKind, boolean>>(allKindsShown);
    const toggleKind = (kind: CalendarKind) =>
        setShown((current) => ({ ...current, [kind]: !current[kind] }));

    const sources = {
        sermon: useCalendarSermons(),
        group: useCalendarGroups(),
        council: useCalendarCouncils(),
        note: useCalendarNotes(),
        prayer: useCalendarPrayers(),
    };
    const { sermons, pendingSermons } = sources.sermon;
    const { groups } = sources.group;
    const { entries: councilCalendarEntries } = sources.council;
    const { entries: noteCalendarEntries } = sources.note;
    const { entries: prayerCalendarEntries } = sources.prayer;

    const readSource = (kind: CalendarKind): ListReadSource => {
        const { isLoading, complete, checking, error } = sources[kind];
        return { loading: isLoading || (!complete && checking), error };
    };
    const calendarRead = listReadState(...CALENDAR_KINDS.map(readSource));
    const visibleKinds = CALENDAR_KINDS.filter(kind => shown[kind]);
    const waitingForVisibleSource = visibleKinds.some(kind => readSource(kind).loading);
    const readyKinds = CALENDAR_KINDS.filter(kind => sources[kind].complete && listReadState(readSource(kind)) === 'ready');
    const canDescribeVisible = visibleKinds.every(kind => readyKinds.includes(kind));
    const sermonsReady = readyKinds.includes('sermon');

    // Fetch series data for series color indicators
    const { series: allSeries } = useSeries(user?.uid || null);

    /*
     * EVERYTHING THE CALENDAR SHOWS, IN ONE SHAPE (`utils/calendarEntries.ts`). Each source is
     * translated once; from here down nothing on this page knows what a sermon or a council is,
     * which is why the third kind cost a line rather than a pass through every view — and the
     * fourth and fifth, the study notes and the prayers, cost a line each.
     */
    const allEntries = useMemo(
        () => [
            ...sermonEntries(sermons),
            ...groupEntries(groups),
            ...councilCalendarEntries,
            ...noteCalendarEntries,
            ...prayerCalendarEntries,
        ],
        [councilCalendarEntries, groups, noteCalendarEntries, prayerCalendarEntries, sermons]
    );

    const visibleEntries = useMemo(() => allEntries.filter((entry) => shown[entry.kind]), [allEntries, shown]);

    const selectedMonth = format(currentMonth, 'yyyy-MM');
    const entriesThisMonth = useMemo(() => entriesInMonth(visibleEntries, selectedMonth), [visibleEntries, selectedMonth]);
    const dayKinds = useMemo(() => kindsByDate(visibleEntries), [visibleEntries]);
    const monthCounts = useMemo(() => countByKind(entriesThisMonth), [entriesThisMonth]);
    const summaryKinds = readyKinds.filter(kind => kind !== 'sermon' && monthCounts[kind] > 0);

    /** Kept for the analytics view and the month summary, which count preach dates, not entries. */
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
        debugLog('[calendar][page] entries', {
            selectedMonth,
            selectedDate: format(selectedDate, 'yyyy-MM-dd'),
            kinds: monthCounts,
            days: Object.keys(dayKinds).sort(),
            preachedSermonsCount,
            plannedSermonsCount,
        });
    }, [dayKinds, monthCounts, plannedSermonsCount, preachedSermonsCount, selectedDate, selectedMonth]);

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

    return (
        <div className="space-y-6">
            <CalendarHeader
                view={view}
                onViewChange={setView}
                currentMonth={currentMonth}
                onGoToToday={handleGoToToday}
            />
            <ListReadFeedback state={calendarRead} />

            {sermonsReady && (
                <LegacyDataWarning
                    pendingSermons={pendingSermons}
                    onAddDate={handleAddDate}
                />
            )}

            {view === 'month' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1">
                        <PreachCalendar
                            kindsByDate={dayKinds}
                            selectedDate={selectedDate}
                            onDateSelect={setSelectedDate}
                            currentMonth={currentMonth}
                            onMonthChange={handleMonthChange}
                            shown={shown}
                            onToggleKind={toggleKind}
                        />

                        {/* Analytics Mini-Summary could go here */}
                        {(sermonsReady || summaryKinds.length > 0) && (
                            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800/50">
                                <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
                                    {t('calendar.analytics.quickSummary')}
                                </h3>
                                <div className="space-y-2">
                                    {sermonsReady && <div className="flex justify-between text-xs">
                                        <span className="text-blue-600 dark:text-blue-400">{t('calendar.analytics.totalPreachings')}</span>
                                        <span className="font-bold text-blue-900 dark:text-blue-100">
                                            {preachedSermonsCount}
                                        </span>
                                    </div>}
                                    {sermonsReady && plannedSermonsCount > 0 && (
                                        <div className="flex justify-between text-xs">
                                            <span className="text-amber-600 dark:text-amber-400">
                                                {t('calendar.analytics.plannedPreachings', { defaultValue: 'Planned preachings' })}
                                            </span>
                                            <span className="font-bold text-amber-900 dark:text-amber-100">
                                                {plannedSermonsCount}
                                            </span>
                                        </div>
                                    )}
                                    {sermonsReady && pendingSermons.length > 0 && (
                                        <div className="flex justify-between text-xs">
                                            <span className="text-amber-600 dark:text-amber-400">{t('calendar.analytics.pendingDateEntry')}</span>
                                            <span className="font-bold text-amber-900 dark:text-amber-100">
                                                {pendingSermons.length}
                                            </span>
                                        </div>
                                    )}
                                    {/*
                                      Every other kind of this month, one quiet row each, in the colour the
                                      kind wears everywhere else on this page — so a new kind gets its row
                                      without a block written by hand.
                                    */}
                                    {summaryKinds.map((kind) => (
                                        <div key={kind} className="flex justify-between text-xs" data-testid={`calendar-summary-${kind}`}>
                                            <span className={CALENDAR_KIND_STYLE[kind].legendLabel}>
                                                {t(CALENDAR_KIND_STYLE[kind].legendKey)}
                                            </span>
                                            <span className={`font-bold ${CALENDAR_KIND_STYLE[kind].legendLabel}`}>
                                                {monthCounts[kind]}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-2">
                        {waitingForVisibleSource && entriesThisMonth.length === 0 ? (
                            <div className="space-y-4">
                                {[1, 2].map(i => (
                                    <div key={i} className="h-32 bg-white dark:bg-gray-800 rounded-xl animate-pulse border border-gray-200 dark:border-gray-700" />
                                ))}
                            </div>
                        ) : (
                            <DateEventList month={currentMonth} entries={entriesThisMonth} series={allSeries}
                                canDescribe={canDescribeVisible} knownCountKinds={readyKinds} />
                        )}
                    </div>
                </div>
            ) : view === 'agenda' ? (
                <div className="space-y-4">
                    <CalendarKindFilters shown={shown} onToggleKind={toggleKind} />
                    {waitingForVisibleSource && visibleEntries.length === 0 ? (
                        <div className="space-y-4">
                            {[1, 2].map((row) => (
                                <div key={row} className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800" />
                            ))}
                        </div>
                    ) : (
                        <AgendaView entries={visibleEntries} series={allSeries} canDescribe={canDescribeVisible} />
                    )}
                </div>
            ) : (
                sermonsReady ? <AnalyticsSection sermonsByDate={normalizedSermonsByDate} /> : null
            )}

            {isModalOpen && selectedSermon && <EnginePreachDateModal
                key={`${selectedSermon.id}:${selectedSermon.currentPreachDate?.id || 'new'}`}
                sermonId={selectedSermon.id}
                action={{
                    kind: selectedSermon.currentPreachDate?.id ? 'edit' : 'add',
                    dateId: selectedSermon.currentPreachDate?.id || undefined,
                    status: getEffectiveIsPreached(selectedSermon) ? 'preached' : 'planned',
                }}
                onClose={() => {
                    setIsModalOpen(false);
                    setSelectedSermon(null);
                }}
            />}
        </div>
    );
}
