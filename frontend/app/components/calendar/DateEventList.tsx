"use client";

import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { enUS, ru, uk } from "date-fns/locale";
import Link from "next/link";
import { Sermon } from "@/models/models";
import { MapPinIcon, UserIcon, BookOpenIcon } from "@heroicons/react/24/outline";

interface DateEventListProps {
    date: Date;
    sermons: Sermon[];
}

export default function DateEventList({ date, sermons }: DateEventListProps) {
    const { t, i18n } = useTranslation();

    const getDateLocale = () => {
        switch (i18n.language) {
            case 'ru': return ru;
            case 'uk': return uk;
            default: return enUS;
        }
    };

    const formattedDate = format(date, 'PPPP', { locale: getDateLocale() });

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {formattedDate}
                </h2>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                    {sermons.length} {t('sermon.outline.thoughts', { count: sermons.length })}
                </span>
            </div>

            {sermons.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                    <p className="text-gray-500 dark:text-gray-400">
                        {t('calendar.noPreachDates')}
                    </p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {sermons.map((sermon) => {
                        const dateStr = format(date, 'yyyy-MM-dd');
                        const preachDate = sermon.preachDates?.find(pd => pd.date === dateStr);

                        return (
                            <Link
                                key={`${sermon.id}-${dateStr}`}
                                href={`/sermons/${sermon.id}`}
                                className="group block bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-500 transition-all shadow-sm hover:shadow-md"
                            >
                                <div className="flex flex-col gap-2">
                                    <div className="flex justify-between items-start">
                                        <h3 className="font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                            {sermon.title}
                                        </h3>
                                        {preachDate?.outcome && (
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${preachDate.outcome === 'excellent' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                    preachDate.outcome === 'good' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                                        preachDate.outcome === 'average' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                }`}>
                                                {t(`calendar.outcomes.${preachDate.outcome}`)}
                                            </span>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
                                        <div className="flex items-center gap-1.5">
                                            <BookOpenIcon className="w-4 h-4 text-gray-400" />
                                            <span className="truncate">{sermon.verse}</span>
                                        </div>
                                        {preachDate && (
                                            <div className="flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400">
                                                <MapPinIcon className="w-4 h-4" />
                                                <span className="truncate">{preachDate.church.name}{preachDate.church.city ? `, ${preachDate.church.city}` : ''}</span>
                                            </div>
                                        )}
                                        {preachDate?.audience && (
                                            <div className="flex items-center gap-1.5">
                                                <UserIcon className="w-4 h-4 text-gray-400" />
                                                <span className="truncate">{preachDate.audience}</span>
                                            </div>
                                        )}
                                    </div>

                                    {preachDate?.notes && (
                                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 line-clamp-2 italic">
                                            "{preachDate.notes}"
                                        </p>
                                    )}
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
