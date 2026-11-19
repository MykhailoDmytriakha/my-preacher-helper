"use client";

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { CheckCircleIcon, ClockIcon, MapPinIcon, PencilSquareIcon, PlusIcon, TrashIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { format } from "date-fns";

import { Chip } from "@/components/ui/Chip";
import { useAppLocale } from "@/hooks/useAppLocale";
import { buildChipClasses } from "@/utils/chipClasses";
import { isUnspecifiedChurch } from "@/utils/church";
import { parseDateOnlyAsLocalDate } from "@/utils/dateOnly";
import { getEffectivePreachDateStatus } from "@/utils/preachDateStatus";
import { useTranslation } from "@locales/useTranslation";

import type { PreachDateAction } from "./preachDateForm";
import type { PreachDate } from "@/models/models";
import type { AppLocale } from "@/utils/appLocale";
import type { ChipTone } from "@/utils/chipClasses";

const OUTCOME_TONES: Record<string, ChipTone> = { excellent: 'emerald', good: 'blue', average: 'amber', poor: 'rose' };
const ICON_BUTTON_CLASSES = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-700';

/** Oldest first, so the line reads as the sermon's history; a date without a day goes last. */
export function orderPreachDates(dates: PreachDate[]): PreachDate[] {
    return [...dates].sort((a, b) => {
        if (!a.date || !b.date) return Number(!a.date) - Number(!b.date);
        return a.date.localeCompare(b.date);
    });
}

/** «22 нояб.» in the current year, «22 нояб. 2025 г.» otherwise; the raw text when it is no date. */
function shortDay(date: string, locale: AppLocale, now: Date): string | null {
    const day = parseDateOnlyAsLocalDate(date);
    if (!day) return date || null;
    const thisYear = day.getFullYear() === now.getFullYear();
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(thisYear ? {} : { year: 'numeric' }) }).format(day);
}

function fullDay(date: string, dateLocale: ReturnType<typeof useAppLocale>['dateLocale']): string | null {
    const day = parseDateOnlyAsLocalDate(date);
    if (!day) return date || null;
    const text = format(day, 'PPPP', { locale: dateLocale });
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The sermon's preach dates, each once, as a chip in the line under the title: green with a tick
 * when preached, amber with a clock while planned, then the day and the church. Pressing a chip
 * opens that date's card; its actions and «+» open the one preach-date window (`EnginePreachDateModal`).
 */
export function PreachDateChips({ preachDates, isPreached = false, disabled = false, onAction }: {
    preachDates: PreachDate[]; isPreached?: boolean; disabled?: boolean; onAction: (action: PreachDateAction) => void;
}) {
    const { t } = useTranslation();
    const { locale, dateLocale } = useAppLocale();
    const now = new Date();
    const dates = orderPreachDates(preachDates);

    return <>
        {dates.map((pd) => {
            const preached = getEffectivePreachDateStatus(pd, isPreached) === 'preached';
            const tone: ChipTone = preached ? 'emerald' : 'amber';
            const status = preached ? t('calendar.status.preached') : t('calendar.status.planned');
            const day = shortDay(pd.date, locale, now) ?? t('calendar.dateNotSet');
            const longDay = fullDay(pd.date, dateLocale) ?? t('calendar.dateNotSet');
            const church = isUnspecifiedChurch(pd.church) ? '' : pd.church.name;
            const place = [church, pd.church?.city].filter(Boolean).join(', ');
            const StatusIcon = preached ? CheckCircleIcon : ClockIcon;
            return (
                <Popover key={pd.id} className="relative inline-flex min-w-0 max-w-full">
                    <PopoverButton
                        aria-label={[status, longDay, place].filter(Boolean).join(' · ')}
                        className={`${buildChipClasses({ tone, size: 'sm', interactive: true })} min-w-0 max-w-full gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
                    >
                        <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="shrink-0 font-semibold">{day}</span>
                        {church && <span className="min-w-0 max-w-[10rem] truncate opacity-80">{church}</span>}
                    </PopoverButton>
                    <PopoverPanel
                        anchor="bottom start"
                        className="z-50 w-72 rounded-xl border border-gray-200 bg-white p-3 pb-2 text-gray-900 shadow-lg [--anchor-gap:6px] [--anchor-padding:16px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    >
                        {({ close }) => (
                            <>
                                <div className="flex items-start gap-1">
                                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pt-1.5">
                                        <Chip tone={tone} size="xs" weight="bold" className="uppercase tracking-wider">{status}</Chip>
                                        {pd.outcome && (
                                            <Chip tone={OUTCOME_TONES[pd.outcome] ?? 'rose'} size="xs" weight="bold" className="uppercase tracking-wider">
                                                {t(`calendar.outcomes.${pd.outcome}`)}
                                            </Chip>
                                        )}
                                    </div>
                                    {/* The same pencil and bin each date row always had. */}
                                    {!disabled && <>
                                        <button type="button" title={t('common.edit')} aria-label={t('common.edit')}
                                            className={`${ICON_BUTTON_CLASSES} hover:text-blue-600 dark:hover:text-blue-400`}
                                            onClick={() => { close(); onAction({ kind: 'edit', dateId: pd.id }); }}>
                                            <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                                        </button>
                                        <button type="button" title={t('common.delete')} aria-label={t('common.delete')}
                                            className={`${ICON_BUTTON_CLASSES} -mr-1 hover:text-red-600 dark:hover:text-red-400`}
                                            onClick={() => { close(); onAction({ kind: 'delete', dateId: pd.id }); }}>
                                            <TrashIcon className="h-4 w-4" aria-hidden="true" />
                                        </button>
                                    </>}
                                </div>
                                <p className="mt-1.5 text-sm font-semibold">{longDay}</p>
                                {place && (
                                    <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-600 dark:text-gray-300">
                                        <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
                                        <span className="min-w-0 break-words">{place}</span>
                                    </p>
                                )}
                                {pd.audience && (
                                    <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-600 dark:text-gray-300">
                                        <UserGroupIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                                        <span className="min-w-0 break-words">{pd.audience}</span>
                                    </p>
                                )}
                                {!disabled && !preached && (
                                    <div className="-mx-1 mt-2 border-t border-gray-100 pt-1.5 dark:border-gray-700">
                                        <button type="button"
                                            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                                            onClick={() => { close(); onAction({ kind: 'mark', dateId: pd.id }); }}>
                                            <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />{t('optionMenu.markAsPreached')}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </PopoverPanel>
                </Popover>
            );
        })}
        {!disabled && (
            <button type="button" aria-label={t('calendar.addPreachDate')} onClick={() => onAction({ kind: 'add', status: 'planned' })}
                className={`${buildChipClasses({ tone: 'custom', size: 'sm', interactive: true })} gap-1 border border-dashed border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-600 dark:text-gray-300 dark:hover:text-gray-100`}>
                <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {dates.length ? t('calendar.addDateChip') : t('calendar.addFirstDateChip')}
            </button>
        )}
    </>;
}
