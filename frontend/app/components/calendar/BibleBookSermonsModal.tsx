"use client";

import { XMarkIcon, CalendarIcon, MapPinIcon, BookOpenIcon } from "@heroicons/react/24/outline";
import { format, isValid, parseISO } from "date-fns";
import { enUS, ru, uk } from "date-fns/locale";
import Link from "next/link";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { BibleLocale, BookInfo } from "@/(pages)/(private)/studies/bibleData";
import { PreachDate, Sermon } from "@/models/models";

interface BibleBookSermonsModalProps {
    isOpen: boolean;
    onClose: () => void;
    book: BookInfo | null;
    entries: Array<{ sermon: Sermon; preachDate: PreachDate }>;
}

export default function BibleBookSermonsModal({
    isOpen,
    onClose,
    book,
    entries
}: BibleBookSermonsModalProps) {
    const { t, i18n } = useTranslation();

    const bibleLocale: BibleLocale = useMemo(() => {
        const lang = i18n.language?.toLowerCase() || 'en';
        if (lang.startsWith('ru')) return 'ru';
        if (lang.startsWith('uk')) return 'uk';
        return 'en';
    }, [i18n.language]);

    const getDateLocale = () => {
        switch (bibleLocale) {
            case 'ru': return ru;
            case 'uk': return uk;
            default: return enUS;
        }
    };

    if (!isOpen || !book) return null;

    const bookName = book.names[bibleLocale] || book.names.en;
    const modalTitle = t('calendar.analytics.bookModalTitle', {
        book: bookName,
        defaultValue: `Sermons in ${bookName}`
    });
    const countLabel = t('calendar.analytics.bookModalCount', {
        count: entries.length,
        defaultValue: `${entries.length} sermons`
    });

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="calendar-book-modal-title"
                data-testid="book-sermons-modal"
                className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl border border-gray-100 dark:border-gray-700"
            >
                <div className="flex justify-between items-center p-6 border-b border-gray-100 dark:border-gray-700">
                    <div>
                        <h2 id="calendar-book-modal-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">
                            {modalTitle}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{countLabel}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        aria-label={t('buttons.close', { defaultValue: 'Close' })}
                    >
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6">
                    {entries.length === 0 ? (
                        <div className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-8">
                            {t('calendar.analytics.bookModalEmpty', { defaultValue: 'No sermons for this book yet' })}
                        </div>
                    ) : (
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700">
                            {entries.map(({ sermon, preachDate }) => {
                                const parsedDate = parseISO(preachDate.date);
                                const formattedDate = isValid(parsedDate)
                                    ? format(parsedDate, 'd MMM yyyy', { locale: getDateLocale() })
                                    : preachDate.date;
                                return (
                                    <div
                                        key={`${sermon.id}-${preachDate.id}`}
                                        className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <Link
                                                href={`/sermons/${sermon.id}`}
                                                className="font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors line-clamp-2"
                                            >
                                                {sermon.title || t('calendar.analytics.bookModalUntitled', { defaultValue: 'Untitled sermon' })}
                                            </Link>
                                            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                                                <CalendarIcon className="w-4 h-4" />
                                                <span>{formattedDate}</span>
                                            </div>
                                        </div>

                                        <div className="mt-2 flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                                            <BookOpenIcon className="w-4 h-4 mt-0.5 text-purple-500" />
                                            <span className="break-words whitespace-pre-line flex-1">
                                                {sermon.verse || t('calendar.analytics.bookModalNoVerse', { defaultValue: 'No scripture provided' })}
                                            </span>
                                        </div>

                                        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                            <MapPinIcon className="w-4 h-4 text-blue-500" />
                                            <span>
                                                {preachDate.church.name}
                                                {preachDate.church.city ? `, ${preachDate.church.city}` : ''}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
