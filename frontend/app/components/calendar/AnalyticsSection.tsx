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
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { BIBLE_BOOKS_DATA, BibleLocale, BookInfo, getBookByName } from "@/(pages)/(private)/studies/bibleData";
import { Sermon, PreachDate } from "@/models/models";

interface AnalyticsSectionProps {
    sermonsByDate: Record<string, Sermon[]>;
}

export default function AnalyticsSection({ sermonsByDate }: AnalyticsSectionProps) {
    const { t, i18n } = useTranslation();
    const sermonsLabel = t('calendar.analytics.sermons', { defaultValue: 'sermons' });

    const getDateLocale = () => {
        switch (i18n.language) {
            case 'ru': return ru;
            case 'uk': return uk;
            default: return enUS;
        }
    };

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

            // Topic counts (from title/verse) - improved to match Bible book names
            const verseText = sermon.verse.trim();

            // Try to match against known Bible books using smart recognition
            let matchedBook = null;

            // First, try exact matches using the existing getBookByName function
            const exactMatch = getBookByName(verseText, i18n.language as BibleLocale);
            if (exactMatch) {
                matchedBook = exactMatch.id;
            }


            // Special handling for verses starting with "-" (multiple books) - do this before fuzzy matching
            if (!matchedBook && verseText.startsWith('-')) {
                // Try to find the first book name after the dash
                const bookAfterDash = verseText.match(/-\s*([А-Яа-яA-Za-z]+)\s+/);
                if (bookAfterDash) {
                    const possibleBook = bookAfterDash[1];
                    // Try to match this as a book
                    const bookMatch = getBookByName(possibleBook, i18n.language as BibleLocale);
                    if (bookMatch) {
                        matchedBook = bookMatch.id;
                    }
                }
            }

            // If no exact match and no special handling, try fuzzy matching for common patterns
            if (!matchedBook) {
                const lowerVerse = verseText.toLowerCase();

                for (const book of BIBLE_BOOKS_DATA) {
                    // Check if verse starts with any part of the book name or abbreviation
                    const bookNames = [
                        book.names.en.toLowerCase(),
                        book.names.ru.toLowerCase(),
                        book.names.uk?.toLowerCase(),
                        book.abbrev.en.toLowerCase(),
                        book.abbrev.ru.toLowerCase(),
                        book.abbrev.uk?.toLowerCase()
                    ].filter(Boolean);

                    // Check for partial matches (verse starts with book name/abbrev)
                    for (const name of bookNames) {
                        if (lowerVerse.startsWith(name)) {
                            matchedBook = book.id;
                            break;
                        }
                        // Also check if book name starts with verse text (for partial inputs)
                        if (name.startsWith(lowerVerse.substring(0, Math.min(4, lowerVerse.length)))) {
                            matchedBook = book.id;
                            break;
                        }
                    }

                    if (matchedBook) break;

                    // Special handling for Russian abbreviations commonly used in sermons
                    if (i18n.language === 'ru') {
                        // Proverbs variations
                        if (book.id === 'Proverbs' && (lowerVerse.startsWith('притч') || lowerVerse.startsWith('прит'))) {
                            matchedBook = book.id;
                            break;
                        }
                        // Matthew variations
                        if (book.id === 'Matthew' && (lowerVerse.startsWith('мф') || lowerVerse.startsWith('мат'))) {
                            matchedBook = book.id;
                            break;
                        }
                        // 1 Samuel variations
                        if (book.id === '1 Samuel' && (lowerVerse.startsWith('1цар') || lowerVerse.startsWith('1 царств') || lowerVerse.startsWith('1 царств'))) {
                            matchedBook = book.id;
                            break;
                        }
                    }
                }
            }

            // Fallback to regex if no direct match
            let topic = matchedBook;
            if (!topic) {
                const topicMatch = sermon.verse.match(/^(\d+\s*)?([^\s\d:]+)/);
                topic = topicMatch ? topicMatch[0].trim() : (sermon.verse.split(' ')[0] || 'Unknown');
            }

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

        const topChurches = Object.entries(churchCounts).sort((a, b) => b[1] - a[1]);
        const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]);

        const avgPrepTime = preachingsWithDates > 0 ? Math.round(totalPrepDays / preachingsWithDates) : 0;

        const totalTopicsSum = Object.values(topicCounts).reduce((a, b) => a + b, 0);
        const totalChurchesSum = Object.values(churchCounts).reduce((a, b) => a + b, 0);

        const churchMax = topChurches.length > 0 ? Math.max(...topChurches.map(c => c[1])) : 0;
        const topicMax = topTopics.length > 0 ? Math.max(...topTopics.map(t => t[1])) : 0;

        // Bible books distribution
        const bibleBookCounts: Record<string, number> = {};
        BIBLE_BOOKS_DATA.forEach(book => {
            bibleBookCounts[book.id] = topicCounts[book.id] || 0;
        });

        // Sort Old Testament books according to Synodal Bible order for Russian locale
        const getOldTestamentOrder = (locale: string): BookInfo[] => {
            if (locale === 'ru') {
                // Synodal Bible order for Old Testament
                const synodalOrder = [
                    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
                    'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings',
                    '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther',
                    'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
                    'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
                    'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'
                ];
                return synodalOrder.map(id => BIBLE_BOOKS_DATA.find(book => book.id === id)).filter((book): book is BookInfo => book !== undefined);
            }
            // Default: first 39 books as-is
            return BIBLE_BOOKS_DATA.slice(0, 39);
        };

        // Sort New Testament books according to Synodal Bible order for Russian locale
        const getNewTestamentOrder = (locale: string): BookInfo[] => {
            if (locale === 'ru') {
                // Synodal Bible order for New Testament
                const synodalOrder = [
                    'Matthew', 'Mark', 'Luke', 'John',
                    'Acts',
                    'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude',
                    'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
                    '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
                    'Hebrews',
                    'Revelation'
                ];
                return synodalOrder.map(id => BIBLE_BOOKS_DATA.find(book => book.id === id)).filter((book): book is BookInfo => book !== undefined);
            }
            // Default: remaining 27 books as-is (standard Protestant order)
            return BIBLE_BOOKS_DATA.slice(39);
        };

        const oldTestamentBooks = getOldTestamentOrder(i18n.language);
        const newTestamentBooks = getNewTestamentOrder(i18n.language);

        const bibleBookMax = Math.max(...Object.values(bibleBookCounts));

        return {
            totalPreachings,
            topChurches,
            avgPrepTime,
            topTopics,
            totalTopicsSum,
            totalChurchesSum,
            churchMax,
            topicMax,
            monthlyActivity: Object.entries(monthCounts)
                .sort((a, b) => {
                    // Sort by year and month numerically
                    const [yearA, monthA] = a[0].split('-').map(Number);
                    const [yearB, monthB] = b[0].split('-').map(Number);
                    if (yearA !== yearB) {
                        return yearA - yearB;
                    }
                    return monthA - monthB;
                })
                .map(([month, count]) => ({ month, count })),
            bibleBookCounts,
            oldTestamentBooks,
            newTestamentBooks,
            bibleBookMax
        };
    }, [sermonsByDate, i18n.language]);

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
                        {[...stats.monthlyActivity].sort((a, b) => b.count - a.count)[0]?.month || 'N/A'}
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
