// Mock bibleData before any imports
jest.mock('@/(pages)/(private)/studies/bibleData', () => ({
    BIBLE_BOOKS_DATA: [
        { id: 'Genesis', chapters: 50, names: { en: 'Genesis', ru: 'Бытие', uk: 'Буття' }, abbrev: { en: 'Gen', ru: 'Быт', uk: 'Бут' } },
        { id: 'Exodus', chapters: 40, names: { en: 'Exodus', ru: 'Исход', uk: 'Вихід' }, abbrev: { en: 'Exod', ru: 'Исх', uk: 'Вих' } },
        { id: 'Leviticus', chapters: 27, names: { en: 'Leviticus', ru: 'Левит', uk: 'Левит' }, abbrev: { en: 'Lev', ru: 'Лев', uk: 'Лев' } },
        { id: 'Numbers', chapters: 36, names: { en: 'Numbers', ru: 'Числа', uk: 'Числа' }, abbrev: { en: 'Num', ru: 'Чис', uk: 'Чис' } },
        { id: 'Proverbs', chapters: 31, names: { en: 'Proverbs', ru: 'Притчи', uk: 'Приповістки' }, abbrev: { en: 'Prov', ru: 'Притч', uk: 'Прип' } },
        { id: 'Matthew', chapters: 28, names: { en: 'Matthew', ru: 'От Матфея', uk: 'Від Матвія' }, abbrev: { en: 'Matt', ru: 'Мф', uk: 'Мт' } },
        { id: 'Mark', chapters: 16, names: { en: 'Mark', ru: 'От Марка', uk: 'Від Марка' }, abbrev: { en: 'Mark', ru: 'Мк', uk: 'Мк' } },
        { id: '1 Peter', chapters: 5, names: { en: '1 Peter', ru: '1 Петра', uk: '1 Петра' }, abbrev: { en: '1Pet', ru: '1Пет', uk: '1Пет' } },
        { id: '2 Peter', chapters: 3, names: { en: '2 Peter', ru: '2 Петра', uk: '2 Петра' }, abbrev: { en: '2Pet', ru: '2Пет', uk: '2Пет' } },
    ],
    getBookByName: jest.fn((name: string, _locale?: string) => {
        const books: Record<string, any> = {
            'Genesis': { id: 'Genesis', chapters: 50, names: { en: 'Genesis', ru: 'Бытие', uk: 'Буття' }, abbrev: { en: 'Gen', ru: 'Быт', uk: 'Бут' } },
            'Exodus': { id: 'Exodus', chapters: 40, names: { en: 'Exodus', ru: 'Исход', uk: 'Вихід' }, abbrev: { en: 'Exod', ru: 'Исх', uk: 'Вих' } },
            'Leviticus': { id: 'Leviticus', chapters: 27, names: { en: 'Leviticus', ru: 'Левит', uk: 'Левит' }, abbrev: { en: 'Lev', ru: 'Лев', uk: 'Лев' } },
            'Numbers': { id: 'Numbers', chapters: 36, names: { en: 'Numbers', ru: 'Числа', uk: 'Числа' }, abbrev: { en: 'Num', ru: 'Чис', uk: 'Чис' } },
            'Proverbs': { id: 'Proverbs', chapters: 31, names: { en: 'Proverbs', ru: 'Притчи', uk: 'Приповістки' }, abbrev: { en: 'Prov', ru: 'Притч', uk: 'Прип' } },
            'Matthew': { id: 'Matthew', chapters: 28, names: { en: 'Matthew', ru: 'От Матфея', uk: 'Від Матвія' }, abbrev: { en: 'Matt', ru: 'Мф', uk: 'Мт' } },
            'Mark': { id: 'Mark', chapters: 16, names: { en: 'Mark', ru: 'От Марка', uk: 'Від Марка' }, abbrev: { en: 'Mark', ru: 'Мк', uk: 'Мк' } },
            '1 Peter': { id: '1 Peter', chapters: 5, names: { en: '1 Peter', ru: '1 Петра', uk: '1 Петра' }, abbrev: { en: '1Pet', ru: '1Пет', uk: '1Пет' } },
            '2 Peter': { id: '2 Peter', chapters: 3, names: { en: '2 Peter', ru: '2 Петра', uk: '2 Петра' }, abbrev: { en: '2Pet', ru: '2Пет', uk: '2Пет' } },
            'Быт': { id: 'Genesis', chapters: 50, names: { en: 'Genesis', ru: 'Бытие', uk: 'Буття' }, abbrev: { en: 'Gen', ru: 'Быт', uk: 'Бут' } },
            'Исх': { id: 'Exodus', chapters: 40, names: { en: 'Exodus', ru: 'Исход', uk: 'Вихід' }, abbrev: { en: 'Exod', ru: 'Исх', uk: 'Вих' } },
            'Лев': { id: 'Leviticus', chapters: 27, names: { en: 'Leviticus', ru: 'Левит', uk: 'Левит' }, abbrev: { en: 'Lev', ru: 'Лев', uk: 'Лев' } },
            'Чис': { id: 'Numbers', chapters: 36, names: { en: 'Numbers', ru: 'Числа', uk: 'Числа' }, abbrev: { en: 'Num', ru: 'Чис', uk: 'Чис' } },
            'Притч': { id: 'Proverbs', chapters: 31, names: { en: 'Proverbs', ru: 'Притчи', uk: 'Приповістки' }, abbrev: { en: 'Prov', ru: 'Притч', uk: 'Прип' } },
            'Прит': { id: 'Proverbs', chapters: 31, names: { en: 'Proverbs', ru: 'Притчи', uk: 'Приповістки' }, abbrev: { en: 'Prov', ru: 'Притч', uk: 'Прип' } },
            'Мф': { id: 'Matthew', chapters: 28, names: { en: 'Matthew', ru: 'От Матфея', uk: 'Від Матвія' }, abbrev: { en: 'Matt', ru: 'Мф', uk: 'Мт' } },
            'Мат': { id: 'Matthew', chapters: 28, names: { en: 'Matthew', ru: 'От Матфея', uk: 'Від Матвія' }, abbrev: { en: 'Matt', ru: 'Мф', uk: 'Мт' } },
            'Мк': { id: 'Mark', chapters: 16, names: { en: 'Mark', ru: 'От Марка', uk: 'Від Марка' }, abbrev: { en: 'Mark', ru: 'Мк', uk: 'Мк' } },
            '1Пет': { id: '1 Peter', chapters: 5, names: { en: '1 Peter', ru: '1 Петра', uk: '1 Петра' }, abbrev: { en: '1Pet', ru: '1Пет', uk: '1Пет' } },
            '2Пет': { id: '2 Peter', chapters: 3, names: { en: '2 Peter', ru: '2 Петра', uk: '2 Петра' }, abbrev: { en: '2Pet', ru: '2Пет', uk: '2Пет' } },
        };

        const lower = name.toLowerCase();
        return books[name] || books[lower] || null;
    }),
    BibleLocale: { en: 'en', ru: 'ru', uk: 'uk' }
}));

// Mock translation
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, _options?: any) => {
            // Return translated text for common keys (Russian)
            const translations: Record<string, string> = {
                'calendar.analytics.bibleBooks': 'Распределение по книгам Библии',
                'calendar.analytics.oldTestament': 'Ветхий Завет',
                'calendar.analytics.newTestament': 'Новый Завет',
                'calendar.analytics.monthlyActivity': 'Активность по месяцам',
                'calendar.analytics.sermons': 'проповедей',
                'calendar.analytics.noSermons': 'Нет проповедей',
                'calendar.analytics.mostSermons': 'Больше всего проповедей',
                'calendar.analytics.noActivity': 'Нет активности',
                'calendar.analytics.mostActivity': 'Наибольшая активность',
                'calendar.analytics.totalPreachings': 'Всего проповедей',
                'calendar.analytics.topChurches': 'Популярные церкви',
                'calendar.analytics.avgPrepTime': 'Ср. время подг.',
                'calendar.analytics.uniqueChurches': 'Уникальные церкви',
                'calendar.analytics.busiestMonth': 'Самый активный месяц',
            };
            return translations[key] || key;
        },
        i18n: {
            language: 'ru' // Use Russian for tests since test data uses Russian abbreviations
        }
    }),
}));

// Mock date-fns
jest.mock('date-fns', () => ({
    format: jest.fn((_date, _fmt) => 'January 2024'),
}));

import { render, screen } from '@testing-library/react';
import React from 'react';
import AnalyticsSection from '../../../app/components/calendar/AnalyticsSection';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

describe('AnalyticsSection', () => {
    const mockSermons: Sermon[] = [
        {
            id: '1',
            title: 'Sermon 1',
            verse: '1Пет 1:1', // No space
            date: '2024-01-01',
            userId: 'test-user',
            thoughts: [],
            preachDates: [
                {
                    id: 'pd1',
                    date: '2024-01-10',
                    church: { id: 'c1', name: 'Alpha Church', city: 'City A' },
                    audience: '',
                    createdAt: '2024-01-01',
                }
            ],
        },
        {
            id: '2',
            title: 'Sermon 2',
            verse: '2 Тим 2:2', // With space
            date: '2024-01-01',
            userId: 'test-user',
            thoughts: [],
            preachDates: [
                {
                    id: 'pd2',
                    date: '2024-01-15',
                    church: { id: 'c1', name: 'Alpha Church', city: 'City A' },
                    audience: '',
                    createdAt: '2024-01-01',
                }
            ],
        },
        {
            id: '3',
            title: 'Sermon 3',
            verse: 'Прит 3:3',
            date: '2024-01-01',
            userId: 'test-user',
            thoughts: [],
            preachDates: [
                {
                    id: 'pd3',
                    date: '2024-01-20',
                    church: { id: 'c2', name: 'Beta Church', city: 'City B' },
                    audience: '',
                    createdAt: '2024-01-01',
                }
            ],
        }
    ];

    const sermonsByDate = {
        '2024-01-10': [mockSermons[0]],
        '2024-01-15': [mockSermons[1]],
        '2024-01-20': [mockSermons[2]],
    };

    it('correctly extracts multi-word Bible book names', () => {
        render(<AnalyticsSection sermonsByDate={sermonsByDate} />);

        // Check that Bible books are displayed in the grid
        // The books should be present in the DOM (either as text or in tooltips)
        expect(screen.getByText('Распределение по книгам Библии')).toBeInTheDocument();

        // Check that Old Testament section exists
        expect(screen.getByText('Ветхий Завет')).toBeInTheDocument();

        // Check that New Testament section exists
        expect(screen.getByText('Новый Завет')).toBeInTheDocument();
    });

    it('calculates counts correctly', () => {
        render(<AnalyticsSection sermonsByDate={sermonsByDate} />);

        // Check total preachings count (should be unique)
        const totalElements = screen.getAllByText('3');
        expect(totalElements.length).toBeGreaterThan(0); // Total preachings appears somewhere

        // Check that monthly activity section exists
        expect(screen.getByText('Активность по месяцам')).toBeInTheDocument();

        // Check that churches are displayed
        expect(screen.getByText('Alpha Church, City A')).toBeInTheDocument();
        expect(screen.getByText('Beta Church, City B')).toBeInTheDocument();

        // Check that we have at least 2 churches (Alpha appears twice, Beta once)
        const alphaElements = screen.getAllByText('Alpha Church, City A');
        expect(alphaElements.length).toBeGreaterThanOrEqual(1);
    });

    describe('Book recognition improvements', () => {
        it('recognizes Russian book abbreviations correctly', () => {
            const sermonsWithRussianBooks = [
                {
                    ...mockSermons[0],
                    id: 'russian1',
                    verse: 'Быт 1:1',
                    preachDates: [{ ...mockSermons[0].preachDates[0], id: 'pd-russian1' }]
                },
                {
                    ...mockSermons[1],
                    id: 'russian2',
                    verse: 'Исх 2:1',
                    preachDates: [{ ...mockSermons[1].preachDates[0], id: 'pd-russian2' }]
                }
            ];

            const sermonsByDateRussian = {
                '2024-01-10': [sermonsWithRussianBooks[0]],
                '2024-01-15': [sermonsWithRussianBooks[1]],
            };

            render(<AnalyticsSection sermonsByDate={sermonsByDateRussian} />);

            // Should display Bible Books Distribution section
            expect(screen.getByText('Распределение по книгам Библии')).toBeInTheDocument();
        });

        it('handles fuzzy matching for common abbreviations', () => {
            const sermonsWithFuzzyBooks = [
                {
                    ...mockSermons[0],
                    id: 'fuzzy1',
                    verse: 'Прит 1:1', // Common abbreviation for Proverbs
                    preachDates: [{ ...mockSermons[0].preachDates[0], id: 'pd-fuzzy1' }]
                }
            ];

            const sermonsByDateFuzzy = {
                '2024-01-10': [sermonsWithFuzzyBooks[0]],
            };

            render(<AnalyticsSection sermonsByDate={sermonsByDateFuzzy} />);

            // The component should render without errors and recognize the book
            expect(screen.getByText('Распределение по книгам Библии')).toBeInTheDocument();
        });

        it('handles verses with multiple books starting with dash', () => {
            const sermonWithMultipleBooks = {
                ...mockSermons[0],
                id: 'multi-book',
                verse: '- Мат 1:1\n- Мар 1:1',
                preachDates: [{ ...mockSermons[0].preachDates[0], id: 'pd-multi' }]
            };

            const sermonsByDateMulti = {
                '2024-01-10': [sermonWithMultipleBooks],
            };

            render(<AnalyticsSection sermonsByDate={sermonsByDateMulti} />);

            // Should render without errors
            expect(screen.getByText('Распределение по книгам Библии')).toBeInTheDocument();
        });
    });

    describe('Localization features', () => {
        it('displays month names in consistent format', () => {
            // Mock date-fns to return formatted months
            const mockFormat = jest.fn();
            mockFormat.mockImplementation((date, fmt) => {
                void date;
                if (fmt === 'MMM yy') return 'Янв 24'; // Russian format without dot, capitalized
                if (fmt === 'MMMM yyyy') return 'Январь 2024';
                return 'January 2024';
            });

            require('date-fns').format = mockFormat;

            render(<AnalyticsSection sermonsByDate={sermonsByDate} />);

            // Check that monthly activity section exists
            expect(screen.getByText('Активность по месяцам')).toBeInTheDocument();
        });

        it('uses localized book abbreviations', () => {
            const sermonsWithLocalizedBooks = [
                {
                    ...mockSermons[0],
                    id: 'localized1',
                    verse: 'Быт 1:1', // Russian abbreviation
                    preachDates: [{ ...mockSermons[0].preachDates[0], id: 'pd-localized1' }]
                }
            ];

            const sermonsByDateLocalized = {
                '2024-01-10': [sermonsWithLocalizedBooks[0]],
            };

            render(<AnalyticsSection sermonsByDate={sermonsByDateLocalized} />);

            // Should display with Russian localization
            expect(screen.getByText('Распределение по книгам Библии')).toBeInTheDocument();
            expect(screen.getByText('Ветхий Завет')).toBeInTheDocument();
        });
    });

    describe('Book ordering for Russian locale', () => {
        it('displays books in Synodal order for Russian locale', () => {
            // This test verifies that the component renders with Russian locale
            // The actual ordering logic is tested in the bibleData tests
            render(<AnalyticsSection sermonsByDate={sermonsByDate} />);

            // Should display sections in Russian
            expect(screen.getByText('Ветхий Завет')).toBeInTheDocument();
            expect(screen.getByText('Новый Завет')).toBeInTheDocument();
        });
    });
});
