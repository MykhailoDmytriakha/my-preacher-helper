import { BIBLE_BOOKS_DATA, BibleLocale, BookInfo, getBookByName } from "@/(pages)/(private)/studies/bibleData";
import { PreachDate, Sermon } from "@/models/models";

export type SermonsByDate = Record<string, Sermon[]>;

type PreachDateEntry = { pd: PreachDate; sermon: Sermon };

export type AnalyticsStats = {
    totalPreachings: number;
    topChurches: Array<[string, number]>;
    avgPrepTime: number;
    topTopics: Array<[string, number]>;
    totalTopicsSum: number;
    totalChurchesSum: number;
    churchMax: number;
    topicMax: number;
    monthlyActivity: Array<{ month: string; count: number }>;
    busiestMonthLabel?: string;
    bibleBookCounts: Record<string, number>;
    oldTestamentBooks: BookInfo[];
    newTestamentBooks: BookInfo[];
    bibleBookMax: number;
};

export const parseDateInfo = (dateStr: string): { year: number; monthKey: string; monthOnly: string } => {
    let year = 0;
    let monthNum = 0;

    // Use regex split to handle both '-' and '.' delimiters
    const parts = dateStr.split(/[-.]/);
    if (parts.length >= 3) {
        // Find which part looks like a 4-digit year
        const yearIdx = parts.findIndex(p => p.length === 4);
        if (yearIdx !== -1) {
            year = Number(parts[yearIdx]);
            // Usually the month is at index 1 regardless of order (YYYY-MM-DD or DD.MM.YYYY)
            monthNum = Number(parts[1]);
        } else {
            // If no 4-digit year found, assume the first part over 31 is year, or last part
            const p0 = Number(parts[0]);
            if (p0 > 31) {
                year = p0;
                monthNum = Number(parts[1]);
            } else {
                year = Number(parts[2]);
                monthNum = Number(parts[1]);
            }
        }
    } else {
        // Fallback for simple YYYY-MM strings or partial ISO
        year = Number(dateStr.substring(0, 4));
        monthNum = Number(dateStr.substring(5, 7));
    }

    // Ensure 2-digit padding for month to match computeMonthlyActivity expectation
    const monthOnly = String(monthNum).padStart(2, '0');
    const monthKey = `${year}-${monthOnly}`;

    return { year, monthKey, monthOnly };
};

const buildAllPreachDates = (sermonsByDate: SermonsByDate): PreachDateEntry[] => {
    const allPreachDates: PreachDateEntry[] = [];

    Object.entries(sermonsByDate).forEach(([dateStr, sermonsForDate]) => {
        sermonsForDate.forEach(sermon => {
            const pd = sermon.preachDates?.find(p => p.date === dateStr);
            if (pd) {
                allPreachDates.push({ pd, sermon });
            }
        });
    });

    return allPreachDates;
};

const filterPreachDatesByYear = (
    allPreachDates: PreachDateEntry[],
    selectedYear: number | 'all'
): PreachDateEntry[] => {
    if (selectedYear === 'all') return allPreachDates;
    return allPreachDates.filter(({ pd }) => {
        const { year } = parseDateInfo(pd.date);
        return year === selectedYear;
    });
};

const buildBookNameCandidates = (book: BookInfo): string[] => ([
    book.names.en.toLowerCase(),
    book.names.ru.toLowerCase(),
    book.names.uk?.toLowerCase(),
    book.abbrev.en.toLowerCase(),
    book.abbrev.ru.toLowerCase(),
    book.abbrev.uk?.toLowerCase()
].filter(Boolean));

const matchBookByNameCandidates = (lowerVerse: string, book: BookInfo): string | null => {
    const bookNames = buildBookNameCandidates(book);
    for (const name of bookNames) {
        if (lowerVerse.startsWith(name)) return book.id;
        if (name.startsWith(lowerVerse.substring(0, Math.min(4, lowerVerse.length)))) return book.id;
    }
    return null;
};

const matchRussianSpecial = (lowerVerse: string, book: BookInfo, locale: string): string | null => {
    if (locale !== 'ru') return null;
    if (book.id === 'Matthew' && (lowerVerse.startsWith('мф') || lowerVerse.startsWith('мат'))) return book.id;
    if (book.id === '1 Samuel' && (lowerVerse.startsWith('1цар') || lowerVerse.startsWith('1 царств') || lowerVerse.startsWith('1 царств'))) return book.id;
    return null;
};

const findFuzzyBookMatch = (verseText: string, locale: string): string | null => {
    const lowerVerse = verseText.toLowerCase();
    for (const book of BIBLE_BOOKS_DATA) {
        const nameMatch = matchBookByNameCandidates(lowerVerse, book);
        if (nameMatch) return nameMatch;
        const specialMatch = matchRussianSpecial(lowerVerse, book, locale);
        if (specialMatch) return specialMatch;
    }
    return null;
};

const findDashBookMatch = (verseText: string, locale: string): string | null => {
    if (!verseText.startsWith('-')) return null;
    const bookAfterDash = verseText.match(/-\s*([А-Яа-яA-Za-z]+)\s+/);
    if (!bookAfterDash) return null;
    const possibleBook = bookAfterDash[1];
    const bookMatch = getBookByName(possibleBook, locale as BibleLocale);
    return bookMatch ? bookMatch.id : null;
};

const resolveMatchedBook = (verseText: string, locale: string): string | null => {
    const exactMatch = getBookByName(verseText, locale as BibleLocale);
    if (exactMatch) return exactMatch.id;

    const dashMatch = findDashBookMatch(verseText, locale);
    if (dashMatch) return dashMatch;

    return findFuzzyBookMatch(verseText, locale);
};

const resolveTopicFromVerse = (rawVerse: string, locale: string): string => {
    const verseText = rawVerse.trim();
    const matchedBook = resolveMatchedBook(verseText, locale);
    if (matchedBook) return matchedBook;

    const topicMatch = rawVerse.match(/^(\d+\s*)?([^\s\d:]+)/);
    return topicMatch ? topicMatch[0].trim() : (rawVerse.split(' ')[0] || 'Unknown');
};

const getOldTestamentOrder = (locale: string): BookInfo[] => {
    if (locale === 'ru') {
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
    return BIBLE_BOOKS_DATA.slice(0, 39);
};

const getNewTestamentOrder = (locale: string): BookInfo[] => {
    if (locale === 'ru') {
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
    return BIBLE_BOOKS_DATA.slice(39);
};

const computeMonthlyActivity = (
    monthCounts: Record<string, number>,
    selectedYear: number | 'all'
): Array<{ month: string; count: number }> => {
    if (selectedYear === 'all') {
        return Object.entries(monthCounts)
            .sort((a, b) => {
                const [yearA, monthA] = a[0].split('-').map(Number);
                const [yearB, monthB] = b[0].split('-').map(Number);
                if (yearA !== yearB) {
                    return yearA - yearB;
                }
                return monthA - monthB;
            })
            .map(([month, count]) => ({ month, count }));
    }

    return Array.from({ length: 12 }, (_, index) => {
        const month = String(index + 1).padStart(2, '0');
        const key = `${selectedYear}-${month}`;
        return { month: key, count: monthCounts[key] || 0 };
    });
};

export const computeAnalyticsStats = ({
    sermonsByDate,
    selectedYear,
    locale,
}: {
    sermonsByDate: SermonsByDate;
    selectedYear: number | 'all';
    locale: string;
}): AnalyticsStats => {
    const allPreachDates = buildAllPreachDates(sermonsByDate);
    const filteredPreachDates = filterPreachDatesByYear(allPreachDates, selectedYear);

    const totalPreachings = filteredPreachDates.length;

    const churchCounts: Record<string, number> = {};
    const monthCounts: Record<string, number> = {};
    const topicCounts: Record<string, number> = {};

    let totalPrepDays = 0;
    let preachingsWithDates = 0;

    filteredPreachDates.forEach(({ pd, sermon }) => {
        const churchKey = `${pd.church.name}${pd.church.city ? `, ${pd.church.city}` : ''}`;
        churchCounts[churchKey] = (churchCounts[churchKey] || 0) + 1;

        const { monthKey } = parseDateInfo(pd.date);
        monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;

        const topic = resolveTopicFromVerse(sermon.verse, locale);
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;

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

    const monthlyActivity = computeMonthlyActivity(monthCounts, selectedYear);
    const busiestMonth = monthlyActivity.reduce<{ month: string; count: number } | null>((best, current) => {
        if (current.count === 0) return best;
        if (!best || current.count > best.count) {
            return current;
        }
        return best;
    }, null);

    const bibleBookCounts: Record<string, number> = {};
    BIBLE_BOOKS_DATA.forEach(book => {
        bibleBookCounts[book.id] = topicCounts[book.id] || 0;
    });

    const oldTestamentBooks = getOldTestamentOrder(locale);
    const newTestamentBooks = getNewTestamentOrder(locale);

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
        monthlyActivity,
        busiestMonthLabel: busiestMonth && busiestMonth.count > 0 ? busiestMonth.month : undefined,
        bibleBookCounts,
        oldTestamentBooks,
        newTestamentBooks,
        bibleBookMax
    };
};
