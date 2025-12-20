"use client";

import { useTranslation } from "react-i18next";
import { format, parseISO } from "date-fns";
import { enUS, ru, uk } from "date-fns/locale";
import Link from "next/link";
import { Sermon } from "@/models/models";
import { MapPinIcon, UserIcon, BookOpenIcon } from "@heroicons/react/24/outline";

interface DateEventListProps {
    month: Date;
    sermons: Sermon[];
}

export default function DateEventList({ month, sermons }: DateEventListProps) {
    const { t, i18n } = useTranslation();

    const getDateLocale = () => {
        switch (i18n.language) {
            case 'ru': return ru;
            case 'uk': return uk;
            default: return enUS;
        }
    };

    const formattedMonth = format(month, 'MMMM yyyy', { locale: getDateLocale() });

    // Group sermons by date
    const sermonsByDate = sermons.reduce((acc, sermon) => {
        sermon.preachDates?.forEach(pd => {
            const dateKey = pd.date;
            if (!acc[dateKey]) {
                acc[dateKey] = [];
            }
            acc[dateKey].push({
                ...sermon,
                currentPreachDate: pd
            });
        });
        return acc;
    }, {} as Record<string, (Sermon & { currentPreachDate: any })[]>);

    // Sort dates chronologically
    const sortedDates = Object.keys(sermonsByDate).sort();

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {formattedMonth}
                </h2>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                    {sermons.length} {t('calendar.totalSermonsWord', { count: sermons.length })}
                </span>
            </div>

            <div className="space-y-6">
                {sortedDates.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                        <p className="text-gray-500 dark:text-gray-400">
                            {t('calendar.noPreachDates')}
                        </p>
                    </div>
                ) : (
                    sortedDates.map((dateStr) => {
                        const dateSermons = sermonsByDate[dateStr];
                        const date = parseISO(dateStr);
                        const formattedDate = format(date, 'PPPP', { locale: getDateLocale() });

                        return (
                            <div key={dateStr} className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-md font-medium text-gray-700 dark:text-gray-300">
                                        {formattedDate}
                                    </h3>
                                </div>

                                <div className="grid gap-3">
                                    {dateSermons.map((sermon) => (
                                        <Link
                                            key={`${sermon.id}-${dateStr}`}
                                            href={`/sermons/${sermon.id}`}
                                            className="group block bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-500 transition-all shadow-sm hover:shadow-md"
                                        >
                                            <div className="flex flex-col gap-2">
                                                <div className="flex justify-between items-start">
                                                    <h4 className="font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                        {sermon.title}
                                                    </h4>
                                                    {sermon.currentPreachDate?.outcome && (
                                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${sermon.currentPreachDate.outcome === 'excellent' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                                sermon.currentPreachDate.outcome === 'good' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                                                    sermon.currentPreachDate.outcome === 'average' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                                        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                            }`}>
                                                            {t(`calendar.outcomes.${sermon.currentPreachDate.outcome}`)}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex flex-col gap-2 text-sm text-gray-600 dark:text-gray-400">
                                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                                        {sermon.currentPreachDate && (
                                                            <div className="flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400">
                                                                <MapPinIcon className="w-4 h-4" />
                                                                <span className="truncate">{sermon.currentPreachDate.church.name}{sermon.currentPreachDate.church.city ? `, ${sermon.currentPreachDate.church.city}` : ''}</span>
                                                            </div>
                                                        )}
                                                        {sermon.currentPreachDate?.audience && (
                                                            <div className="flex items-center gap-1.5">
                                                                <UserIcon className="w-4 h-4 text-gray-400" />
                                                                <span className="truncate">{sermon.currentPreachDate.audience}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex items-start gap-1.5">
                                                        <BookOpenIcon className="w-4 h-4 text-gray-400 mt-0.5" />
                                                        <div className="line-clamp-2 break-words flex-1">{sermon.verse}</div>
                                                    </div>
                                                </div>

                                                {sermon.currentPreachDate?.notes && (
                                                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 line-clamp-2 italic">
                                                        "{sermon.currentPreachDate.notes}"
                                                    </p>
                                                )}
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
