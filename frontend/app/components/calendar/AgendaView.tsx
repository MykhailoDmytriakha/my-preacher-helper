"use client";

import { useTranslation } from "react-i18next";
import { format, parseISO } from "date-fns";
import { enUS, ru, uk } from "date-fns/locale";
import Link from "next/link";
import { Sermon, PreachDate } from "@/models/models";
import { MapPinIcon, UserIcon, BookOpenIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

interface AgendaViewProps {
    sermons: Sermon[];
}

export default function AgendaView({ sermons }: AgendaViewProps) {
    const { t, i18n } = useTranslation();

    const getDateLocale = () => {
        switch (i18n.language) {
            case 'ru': return ru;
            case 'uk': return uk;
            default: return enUS;
        }
    };

    // Extract all preach dates and sort them
    const allEvents = sermons.flatMap(sermon =>
        (sermon.preachDates || []).map(pd => ({
            ...pd,
            sermon
        }))
    ).sort((a, b) => b.date.localeCompare(a.date));

    if (allEvents.length === 0) {
        return (
            <div className="text-center py-20 bg-gray-50 dark:bg-gray-800/30 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                <BookOpenIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    {t('calendar.noPreachDates')}
                </h3>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {allEvents.map((event) => {
                    const eventDate = parseISO(event.date);
                    return (
                        <Link
                            key={event.id}
                            href={`/sermons/${event.sermon.id}`}
                            className="group flex flex-col sm:flex-row sm:items-center gap-4 p-6 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                            <div className="flex flex-col items-center justify-center w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800/50 flex-shrink-0">
                                <span className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400">
                                    {format(eventDate, 'MMM', { locale: getDateLocale() })}
                                </span>
                                <span className="text-xl font-bold text-blue-900 dark:text-blue-100 leading-none">
                                    {format(eventDate, 'd')}
                                </span>
                                <span className="text-[10px] text-blue-600 dark:text-blue-400">
                                    {format(eventDate, 'yyyy')}
                                </span>
                            </div>

                            <div className="flex-grow min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                        {event.sermon.title}
                                    </h3>
                                    {event.outcome && (
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex-shrink-0 ${event.outcome === 'excellent' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                event.outcome === 'good' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                                    event.outcome === 'average' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                            }`}>
                                            {t(`calendar.outcomes.${event.outcome}`)}
                                        </span>
                                    )}
                                </div>

                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                                    <div className="flex items-center gap-1.5">
                                        <MapPinIcon className="w-4 h-4 text-blue-500" />
                                        <span>{event.church.name}{event.church.city ? `, ${event.church.city}` : ''}</span>
                                    </div>
                                    {event.audience && (
                                        <div className="flex items-center gap-1.5">
                                            <UserIcon className="w-4 h-4" />
                                            <span>{event.audience}</span>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-1.5">
                                        <BookOpenIcon className="w-4 h-4" />
                                        <span className="truncate">{event.sermon.verse}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-shrink-0 self-center hidden sm:block">
                                <ChevronRightIcon className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition-colors" />
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
