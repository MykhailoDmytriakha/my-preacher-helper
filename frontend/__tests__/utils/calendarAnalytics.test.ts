import { extractBookIdsFromVerse } from '@/components/calendar/calendarAnalytics';

describe('calendarAnalytics', () => {
    const locale = 'ru';

    describe('extractBookIdsFromVerse', () => {
        it('should extract correct book IDs from various verse strings', () => {
            expect(extractBookIdsFromVerse('Мф 1:1', locale)).toEqual(['Matthew']);
            expect(extractBookIdsFromVerse('Рим 8:1-2', locale)).toEqual(['Romans']);
            expect(extractBookIdsFromVerse('Евр 9:27-28', locale)).toEqual(['Hebrews']);
        });

        it('handles inflections for long book names', () => {
            // "Второзаконии" (prepositional) vs "Второзаконие" (canonical)
            expect(extractBookIdsFromVerse('Второзаконии 12:1', locale)).toContain('Deuteronomy');
            expect(extractBookIdsFromVerse('Откровении 1:1', locale)).toContain('Revelation');
        });

        it('handles merging of digits and letters (merged tokens)', () => {
            expect(extractBookIdsFromVerse('1Ин 1:1', locale)).toContain('1 John');
            expect(extractBookIdsFromVerse('Рим1:1', locale)).toContain('Romans');
        });

        it('handles keywords instead of just numeric tokens', () => {
            expect(extractBookIdsFromVerse('в Римлянам главе 12', locale)).toContain('Romans');
            expect(extractBookIdsFromVerse('Матфея стих 5', locale)).toContain('Matthew');
        });

        it('avoids false positives with common words', () => {
            // "осуждения" should NOT match "Hosea" (Осия) if not followed by a reference
            expect(extractBookIdsFromVerse('Нет никакого осуждения', locale)).not.toContain('Hosea');
        });

        it('supports multiple books and various separators', () => {
            const verse = 'Мф 1:1; Мк 2:2, Лук 3:3. Ин 4:4';
            const result = extractBookIdsFromVerse(verse, locale);
            expect(result).toContain('Matthew');
            expect(result).toContain('Mark');
            expect(result).toContain('Luke');
            expect(result).toContain('John');
        });

        it('prevents bridged token false positives', () => {
            // "3 Ин" should not be matched as "3 John" if "3" is clearly a chapter/verse of "Luke"
            const verse = 'Лук 3:3 Ин 4:4';
            const result = extractBookIdsFromVerse(verse, locale);
            expect(result).not.toContain('3 John');
            expect(result).toContain('Luke');
            expect(result).toContain('John');
        });

        it('handles 1-token matches for merged prefix', () => {
            // "Рим1" should match Romans
            expect(extractBookIdsFromVerse('Рим1', locale)).toContain('Romans');
        });

        it('handles exact matches even with digits', () => {
            expect(extractBookIdsFromVerse('1Кор 1:1', locale)).toContain('1 Corinthians');
        });

        it('handles only book name without reference if it is the only content', () => {
            expect(extractBookIdsFromVerse('Матфея', locale)).toEqual(['Matthew']);
        });

        it('returns empty array for empty or invalid input', () => {
            expect(extractBookIdsFromVerse('', locale)).toEqual([]);
            expect(extractBookIdsFromVerse('   ', locale)).toEqual([]);
            expect(extractBookIdsFromVerse('random text', locale)).toEqual([]);
        });

        it('uses fallback resolver if no matches found via tokens', () => {
            // Let's find something that resolveBookIdFromVerse might catch but tokenization might miss
            // Actually extractBookIdsFromVerse calls resolveBookIdFromVerse at the end.
            expect(extractBookIdsFromVerse('Бытие', locale)).toContain('Genesis');
        });

        it('handles multi-word book names like "1 Паралипоменон"', () => {
            expect(extractBookIdsFromVerse('1Пар 1:1', locale)).toContain('1 Chronicles');
            expect(extractBookIdsFromVerse('1 Паралипоменон 1:1', locale)).toContain('1 Chronicles');
        });
    });

    describe('parseDateInfo', () => {
        const { parseDateInfo } = require('@/components/calendar/calendarAnalytics');
        it('handles ISO dates (YYYY-MM-DD)', () => {
            expect(parseDateInfo('2024-05-15')).toEqual({ year: 2024, monthKey: '2024-05', monthOnly: '05' });
        });
        it('handles dot-separated dates (DD.MM.YYYY)', () => {
            expect(parseDateInfo('15.06.2024')).toEqual({ year: 2024, monthKey: '2024-06', monthOnly: '06' });
        });
        it('handles partial ISO (YYYY-MM)', () => {
            expect(parseDateInfo('2024-07')).toEqual({ year: 2024, monthKey: '2024-07', monthOnly: '07' });
        });
    });

    describe('Analytics Computation', () => {
        const { computeAnalyticsStats, buildBookPreachEntries, buildMonthlyPreachEntries } = require('@/components/calendar/calendarAnalytics');

        const mockSermonsByDate = {
            '2024-01-10': [
                {
                    id: 's1',
                    title: 'Title 1',
                    verse: 'Мф 1:1',
                    date: '2024-01-01',
                    isPreached: true,
                    preachDates: [
                        { id: 'pd1', date: '2024-01-10', church: { name: 'Church A', city: 'City A' } }
                    ]
                }
            ],
            '2024-02-15': [
                {
                    id: 's2',
                    title: 'Title 2',
                    verse: 'Рим 8:1',
                    date: '2024-02-10',
                    isPreached: true,
                    preachDates: [
                        { id: 'pd2', date: '2024-02-15', church: { name: 'Church B' } }
                    ]
                }
            ]
        };

        it('computeAnalyticsStats correctly aggregates data', () => {
            const stats = computeAnalyticsStats({
                sermonsByDate: mockSermonsByDate,
                selectedYear: 2024,
                locale: 'ru'
            });

            expect(stats.totalPreachings).toBe(2);
            expect(stats.avgPrepTime).toBeGreaterThan(0);
            expect(stats.topChurches[0][0]).toContain('Church');
            expect(stats.bibleBookCounts['Matthew']).toBe(1);
            expect(stats.bibleBookCounts['Romans']).toBe(1);
        });

        it('computeAnalyticsStats handles "all" years', () => {
            const stats = computeAnalyticsStats({
                sermonsByDate: mockSermonsByDate,
                selectedYear: 'all',
                locale: 'ru'
            });
            expect(stats.totalPreachings).toBe(2);
        });

        it('buildBookPreachEntries correctly organizes entries', () => {
            const entries = buildBookPreachEntries({
                sermonsByDate: mockSermonsByDate,
                selectedYear: 2024,
                locale: 'ru'
            });

            expect(entries['Matthew']).toHaveLength(1);
            expect(entries['Romans']).toHaveLength(1);
            expect(entries['Matthew'][0].sermon.id).toBe('s1');
        });

        it('buildMonthlyPreachEntries correctly organizes entries by month', () => {
            const entries = buildMonthlyPreachEntries({
                sermonsByDate: mockSermonsByDate,
                selectedYear: 2024
            });

            expect(entries['2024-01']).toHaveLength(1);
            expect(entries['2024-02']).toHaveLength(1);
            expect(entries['2024-01'][0].sermon.id).toBe('s1');
        });
    });
});
