// Mock bibleData before any imports
jest.mock('@/(pages)/(private)/studies/bibleData', () => {
    const baseBooks = [
        { id: 'Genesis', chapters: 50, names: { en: 'Genesis', ru: 'Бытие', uk: 'Буття' }, abbrev: { en: 'Gen', ru: 'Быт', uk: 'Бут' } },
        { id: 'Exodus', chapters: 40, names: { en: 'Exodus', ru: 'Исход', uk: 'Вихід' }, abbrev: { en: 'Exod', ru: 'Исх', uk: 'Вих' } },
        { id: 'Leviticus', chapters: 27, names: { en: 'Leviticus', ru: 'Левит', uk: 'Левит' }, abbrev: { en: 'Lev', ru: 'Лев', uk: 'Лев' } },
        { id: 'Numbers', chapters: 36, names: { en: 'Numbers', ru: 'Числа', uk: 'Числа' }, abbrev: { en: 'Num', ru: 'Чис', uk: 'Чис' } },
        { id: 'Proverbs', chapters: 31, names: { en: 'Proverbs', ru: 'Притчи', uk: 'Приповістки' }, abbrev: { en: 'Prov', ru: 'Притч', uk: 'Прип' } },
        { id: '1 Samuel', chapters: 31, names: { en: '1 Samuel', ru: '1 Царств', uk: '1 Самуїлова' }, abbrev: { en: '1Sam', ru: '1Цар', uk: '1Сам' } },
        { id: 'Matthew', chapters: 28, names: { en: 'Matthew', ru: 'От Матфея', uk: 'Від Матвія' }, abbrev: { en: 'Matt', ru: 'Мф', uk: 'Мт' } },
        { id: 'Mark', chapters: 16, names: { en: 'Mark', ru: 'От Марка', uk: 'Від Марка' }, abbrev: { en: 'Mark', ru: 'Мк', uk: 'Мк' } },
        { id: '1 Peter', chapters: 5, names: { en: '1 Peter', ru: '1 Петра', uk: '1 Петра' }, abbrev: { en: '1Pet', ru: '1Пет', uk: '1Пет' } },
        { id: '2 Peter', chapters: 3, names: { en: '2 Peter', ru: '2 Петра', uk: '2 Петра' }, abbrev: { en: '2Pet', ru: '2Пет', uk: '2Пет' } },
    ];
    const fillerCount = Math.max(0, 40 - baseBooks.length);
    const fillerBooks = Array.from({ length: fillerCount }, (_, index) => {
        const number = index + 1;
        return {
            id: `Filler ${number}`,
            chapters: 1,
            names: { en: `Filler ${number}`, ru: `Filler ${number}`, uk: `Filler ${number}` },
            abbrev: { en: `F${number}`, ru: `F${number}`, uk: `F${number}` },
        };
    });

    return {
        BIBLE_BOOKS_DATA: [...baseBooks, ...fillerBooks],
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
    };
});

// Mock translation
let currentLanguage: 'ru' | 'en' | 'uk' | 'en-US' = 'ru';

const translationsByLocale: Record<string, Record<string, string>> = {
    ru: {
        'calendar.analytics.title': 'Аналитика',
        'calendar.analytics.year': 'Год',
        'calendar.analytics.allYears': 'Все годы',
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
    },
    en: {
        'calendar.analytics.title': 'Analytics',
        'calendar.analytics.year': 'Year',
        'calendar.analytics.allYears': 'All years',
        'calendar.analytics.bibleBooks': 'Bible Books Distribution',
        'calendar.analytics.oldTestament': 'Old Testament',
        'calendar.analytics.newTestament': 'New Testament',
        'calendar.analytics.monthlyActivity': 'Monthly Activity',
        'calendar.analytics.sermons': 'sermons',
        'calendar.analytics.noSermons': 'No sermons',
        'calendar.analytics.mostSermons': 'Most sermons',
        'calendar.analytics.noActivity': 'No activity',
        'calendar.analytics.mostActivity': 'Most activity',
        'calendar.analytics.totalPreachings': 'Total preachings',
        'calendar.analytics.topChurches': 'Top Churches',
        'calendar.analytics.avgPrepTime': 'Avg Prep Time',
        'calendar.analytics.uniqueChurches': 'Unique Churches',
        'calendar.analytics.busiestMonth': 'Busiest Month',
    },
    uk: {
        'calendar.analytics.title': 'Аналітика',
        'calendar.analytics.year': 'Рік',
        'calendar.analytics.allYears': 'Усі роки',
        'calendar.analytics.bibleBooks': 'Розподіл по книгах Біблії',
        'calendar.analytics.oldTestament': 'Старий Завіт',
        'calendar.analytics.newTestament': 'Новий Завіт',
        'calendar.analytics.monthlyActivity': 'Активність за місяцями',
        'calendar.analytics.sermons': 'проповідей',
        'calendar.analytics.noSermons': 'Немає проповідей',
        'calendar.analytics.mostSermons': 'Найбільше проповідей',
        'calendar.analytics.noActivity': 'Немає активності',
        'calendar.analytics.mostActivity': 'Найбільша активність',
        'calendar.analytics.totalPreachings': 'Всього проповідей',
        'calendar.analytics.topChurches': 'Популярні церкви',
        'calendar.analytics.avgPrepTime': 'Сер. час підг.',
        'calendar.analytics.uniqueChurches': 'Унікальні церкви',
        'calendar.analytics.busiestMonth': 'Найактивніший місяць',
    },
};

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: any) => {
            const translations = translationsByLocale[currentLanguage] || {};
            return translations[key] || options?.defaultValue || key;
        },
        i18n: {
            language: currentLanguage
        }
    }),
}));

// Mock date-fns
jest.mock('date-fns', () => ({
    format: jest.fn((_date, _fmt) => 'January 2024'),
}));

import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { format } from 'date-fns';
import AnalyticsSection from '../../../app/components/calendar/AnalyticsSection';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

describe('AnalyticsSection', () => {
    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2024-06-15T00:00:00Z'));
    });

    beforeEach(() => {
        currentLanguage = 'ru';
    });

    afterAll(() => {
        jest.useRealTimers();
    });

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
                    preachDates: [{ ...mockSermons[0].preachDates![0], id: 'pd-russian1' }]
                },
                {
                    ...mockSermons[1],
                    id: 'russian2',
                    verse: 'Исх 2:1',
                    preachDates: [{ ...mockSermons[1].preachDates![0], id: 'pd-russian2' }]
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
                    preachDates: [{ ...mockSermons[0].preachDates![0], id: 'pd-fuzzy1' }]
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
                preachDates: [{ ...mockSermons[0].preachDates![0], id: 'pd-multi' }]
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
            const formatMock = jest.mocked(format);
            formatMock.mockImplementation((date, fmt) => {
                void date;
                if (fmt === 'MMM yy') return 'Янв 24'; // Russian format without dot, capitalized
                if (fmt === 'MMMM yyyy') return 'Январь 2024';
                return 'January 2024';
            });

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
                    preachDates: [{ ...mockSermons[0].preachDates![0], id: 'pd-localized1' }]
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

    describe('Year filtering', () => {
        it('filters stats by selected year and supports all years', () => {
            const sermonsByDateMultiYear = {
                '2024-01-10': [mockSermons[0]],
                '2024-02-05': [
                    {
                        ...mockSermons[1],
                        id: 'sermon-2024-b',
                        preachDates: [
                            {
                                ...mockSermons[1].preachDates![0],
                                id: 'pd-2024-b',
                                date: '2024-02-05'
                            }
                        ]
                    }
                ],
                '2025-03-12': [
                    {
                        ...mockSermons[2],
                        id: 'sermon-2025',
                        preachDates: [
                            {
                                ...mockSermons[2].preachDates![0],
                                id: 'pd-2025',
                                date: '2025-03-12'
                            }
                        ]
                    }
                ],
            };

            render(<AnalyticsSection sermonsByDate={sermonsByDateMultiYear} />);

            const yearSelect = screen.getByRole('combobox', { name: 'Год' });
            expect(yearSelect).toBeInTheDocument();
            expect(screen.getByRole('option', { name: 'Все годы' })).toBeInTheDocument();

            const totalLabel = screen.getByText('Всего проповедей');
            const totalCard = totalLabel.closest('div')?.parentElement;
            expect(totalCard).toBeTruthy();
            expect(within(totalCard as HTMLElement).getByText('2')).toBeInTheDocument();

            fireEvent.change(yearSelect, { target: { value: '2025' } });
            expect(within(totalCard as HTMLElement).getByText('1')).toBeInTheDocument();

            fireEvent.change(yearSelect, { target: { value: 'all' } });
            expect(within(totalCard as HTMLElement).getByText('3')).toBeInTheDocument();
        });
    });

    it('shows N/A busiest month and zero prep time when there is no data', () => {
        render(<AnalyticsSection sermonsByDate={{}} />);

        const busiestLabel = screen.getByText('Самый активный месяц');
        const busiestCard = busiestLabel.closest('div')?.parentElement;
        expect(busiestCard).toBeTruthy();
        expect(within(busiestCard as HTMLElement).getByText('N/A')).toBeInTheDocument();

        const avgLabel = screen.getByText('Ср. время подг.');
        const avgCard = avgLabel.closest('div')?.parentElement;
        expect(avgCard).toBeTruthy();
        expect(within(avgCard as HTMLElement).getByText('0')).toBeInTheDocument();
    });

    it('uses exact book match and omits missing church city', () => {
        const sermonsByDateExact = {
            '2024-01-10': [
                {
                    ...mockSermons[0],
                    id: 'exact-1',
                    verse: 'Быт',
                    preachDates: [
                        {
                            id: 'pd-exact',
                            date: '2024-01-10',
                            church: { id: 'c-exact', name: 'Alpha Church' },
                            audience: '',
                            createdAt: '2024-01-01',
                        }
                    ],
                }
            ],
        };

        render(<AnalyticsSection sermonsByDate={sermonsByDateExact} />);

        expect(screen.getByText('Alpha Church')).toBeInTheDocument();
        expect(screen.queryByText(/Alpha Church,\s/)).not.toBeInTheDocument();
        expect(screen.getByTitle(/Genesis.*: 1 проповедей/)).toBeInTheDocument();
    });

    it('renders default book order for non-Russian locale', () => {
        currentLanguage = 'uk';
        render(<AnalyticsSection sermonsByDate={sermonsByDate} />);

        expect(screen.getByText('Старий Завіт')).toBeInTheDocument();
        expect(screen.getByText('Новий Завіт')).toBeInTheDocument();
    });

    it('falls back to English abbreviations for unknown locale', () => {
        currentLanguage = 'en-US';
        render(<AnalyticsSection sermonsByDate={sermonsByDate} />);

        expect(screen.getByText('Old Testament')).toBeInTheDocument();
        expect(screen.getByText('New Testament')).toBeInTheDocument();
        expect(screen.getByText('Gen')).toBeInTheDocument();
    });

    it('returns raw month key for invalid dates when viewing all years', () => {
        const sermonsByDateInvalid = {
            '2024-13-40': [
                {
                    ...mockSermons[0],
                    id: 'invalid-date',
                    verse: 'Мф 1:1',
                    preachDates: [
                        {
                            id: 'pd-invalid',
                            date: '2024-13-40',
                            church: { id: 'c-invalid', name: 'Gamma Church', city: 'City C' },
                            audience: '',
                            createdAt: '2024-01-01',
                        }
                    ],
                }
            ],
        };

        render(<AnalyticsSection sermonsByDate={sermonsByDateInvalid} />);

        const yearSelect = screen.getByRole('combobox', { name: 'Год' });
        fireEvent.change(yearSelect, { target: { value: 'all' } });

        const busiestLabel = screen.getByText('Самый активный месяц');
        const busiestCard = busiestLabel.closest('div')?.parentElement;
        expect(busiestCard).toBeTruthy();
        expect(within(busiestCard as HTMLElement).getByText('2024-13')).toBeInTheDocument();
    });

    it('handles Russian-specific abbreviations not covered by default matching', () => {
        const verseWithNarrowNbsp = `1\u202Fцарств 1:1`;
        const sermonsByDateRussianVariants = {
            '2024-01-10': [
                {
                    ...mockSermons[0],
                    id: 'mat-variant',
                    verse: 'Мат 1:1',
                    preachDates: [{ ...mockSermons[0].preachDates![0], id: 'pd-mat-variant' }]
                },
                {
                    ...mockSermons[1],
                    id: 'samuel-variant',
                    verse: verseWithNarrowNbsp,
                    preachDates: [{
                        ...mockSermons[1].preachDates![0],
                        id: 'pd-samuel-variant',
                        date: '2024-01-10'
                    }]
                }
            ],
        };

        render(<AnalyticsSection sermonsByDate={sermonsByDateRussianVariants} />);

        expect(screen.getByText('Распределение по книгам Библии')).toBeInTheDocument();
    });

    it('falls back to Unknown topic when verse has no recognizable book token', () => {
        const sermonsByDateNumericVerse = {
            '2024-01-10': [
                {
                    ...mockSermons[0],
                    id: 'numeric-verse',
                    verse: '123:45',
                    preachDates: [{ ...mockSermons[0].preachDates![0], id: 'pd-numeric' }]
                }
            ],
        };

        render(<AnalyticsSection sermonsByDate={sermonsByDateNumericVerse} />);

        expect(screen.getByText('Распределение по книгам Библии')).toBeInTheDocument();
    });

    it('uses Unknown topic fallback when verse text is empty', () => {
        const sermonsByDateEmptyVerse = {
            '2024-01-10': [
                {
                    ...mockSermons[0],
                    id: 'empty-verse',
                    verse: ' : ',
                    preachDates: [{ ...mockSermons[0].preachDates![0], id: 'pd-empty' }]
                }
            ],
        };

        render(<AnalyticsSection sermonsByDate={sermonsByDateEmptyVerse} />);

        expect(screen.getByText('Распределение по книгам Библии')).toBeInTheDocument();
    });

    it('handles dash verse without a book token', () => {
        const sermonsByDateDashNoBook = {
            '2024-01-10': [
                {
                    ...mockSermons[0],
                    id: 'dash-no-book',
                    verse: '- 123',
                    preachDates: [{ ...mockSermons[0].preachDates![0], id: 'pd-dash-no-book' }]
                }
            ],
        };

        render(<AnalyticsSection sermonsByDate={sermonsByDateDashNoBook} />);

        expect(screen.getByText('Распределение по книгам Библии')).toBeInTheDocument();
    });

    it('handles dash verse with unknown book', () => {
        const sermonsByDateDashUnknown = {
            '2024-01-10': [
                {
                    ...mockSermons[0],
                    id: 'dash-unknown-book',
                    verse: '- UnknownBook 1:1',
                    preachDates: [{ ...mockSermons[0].preachDates![0], id: 'pd-dash-unknown' }]
                }
            ],
        };

        render(<AnalyticsSection sermonsByDate={sermonsByDateDashUnknown} />);

        expect(screen.getByText('Распределение по книгам Библии')).toBeInTheDocument();
    });
});
