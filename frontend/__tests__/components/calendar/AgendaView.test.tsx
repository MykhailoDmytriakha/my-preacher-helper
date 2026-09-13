import { render, screen } from '@testing-library/react';
import React from 'react';
import AgendaView from '@/components/calendar/AgendaView';
import { councilEntries, sermonEntries } from '@/utils/calendarEntries';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

// Mock react-i18next
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: any) => {
            // The overflow line is the only string here that carries a number, so the mock has
            // to render it rather than echo the key — otherwise the assertion proves nothing.
            if (key === 'council.moreTopics') return `ещё ${options?.count}`;
            const translations: { [key: string]: string } = {
                'calendar.noPreachDates': 'No preach dates recorded',
                'calendar.outcomes.excellent': 'Excellent',
                'calendar.outcomes.good': 'Good',
                'calendar.outcomes.average': 'Average',
                'calendar.outcomes.poor': 'Poor',
            };
            return translations[key] || key;
        },
        i18n: {
            language: 'en'
        }
    }),
}));

// Mock Next.js router for Link component
jest.mock('next/link', () => {
    return function MockLink({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) {
        return <a href={href} className={className} data-testid="link">{children}</a>;
    };
});

// Mock heroicons
jest.mock('@heroicons/react/24/outline', () => ({
    CalendarDaysIcon: () => <div data-testid="calendar-days-icon" />,
    MapPinIcon: () => <div data-testid="map-pin-icon" />,
    UserIcon: () => <div data-testid="user-icon" />,
    UserGroupIcon: () => <div data-testid="user-group-icon" />,
    ChatBubbleLeftRightIcon: () => <div data-testid="council-icon" />,
    BookOpenIcon: () => <div data-testid="book-open-icon" />,
    ChevronRightIcon: () => <div data-testid="chevron-right-icon" />,
}));

// Mock format from date-fns
jest.mock('date-fns', () => ({
    format: (date: Date, formatStr: string) => {
        if (formatStr === 'MMM') return 'Jan';
        if (formatStr === 'd') return '15';
        if (formatStr === 'yyyy') return '2024';
        return date.toISOString();
    },
    parseISO: (dateStr: string) => new Date(dateStr),
}));

describe('AgendaView', () => {
    const mockSermon: Sermon = {
        id: 'sermon-1',
        title: 'Test Sermon',
        verse: 'John 3:16',
        date: '2024-01-01',
        thoughts: [],
        userId: 'user-1',
        isPreached: false,
        preachDates: [
            {
                id: 'pd-1',
                date: '2024-01-15T00:00:00.000Z',
                church: { id: 'c1', name: 'Test Church', city: 'Test City' },
                audience: '100 people',
                notes: 'Great sermon',
                outcome: 'excellent',
                createdAt: '2024-01-01T00:00:00Z'
            }
        ]
    };

    const mockSermonWithLongVerse: Sermon = {
        ...mockSermon,
        verse: 'Агг 1:5-14: Посему ныне так говорит Господь Саваоф: обратите сердце ваше на пути ваши. Вы сеете много, а собираете мало; едите, но не в сытость.'
    };

    it('renders empty state when no sermons', () => {
        render(<AgendaView entries={[]} series={[]} />);

        expect(screen.getByText('No preach dates recorded')).toBeInTheDocument();
    });

    it('renders sermon information correctly', () => {
        render(<AgendaView entries={sermonEntries([mockSermon])} series={[]} />);

        expect(screen.getByText('Test Sermon')).toBeInTheDocument();
        expect(screen.getByText('Jan')).toBeInTheDocument();
        expect(screen.getByText('15')).toBeInTheDocument();
        expect(screen.getByText('2024')).toBeInTheDocument();
        expect(screen.getByText('John 3:16')).toBeInTheDocument();
        expect(screen.getByText('Test Church, Test City')).toBeInTheDocument();
        expect(screen.getByText('100 people')).toBeInTheDocument();
        expect(screen.getByText('Excellent')).toBeInTheDocument();
    });

    it('displays long sermon verse with proper multi-line classes', () => {
        render(<AgendaView entries={sermonEntries([mockSermonWithLongVerse])} series={[]} />);

        const verseElement = screen.getByText(mockSermonWithLongVerse.verse);
        expect(verseElement).toBeInTheDocument();

        // A long verse wraps onto as many lines as it needs instead of being cut short.
        const verseContainer = verseElement.closest('div');
        expect(verseContainer).toHaveClass('break-words', 'whitespace-pre-line', 'flex-1');
        expect(verseContainer?.parentElement).toBeInTheDocument();
    });

    it('renders multiple sermons for same date', () => {
        const anotherSermon = {
            ...mockSermon,
            id: 'sermon-2',
            title: 'Another Sermon'
        };

        render(<AgendaView entries={sermonEntries([mockSermon, anotherSermon])} series={[]} />);

        expect(screen.getByText('Test Sermon')).toBeInTheDocument();
        expect(screen.getByText('Another Sermon')).toBeInTheDocument();
    });

    it('renders sermons with different outcomes', () => {
        const goodSermon: Sermon = {
            ...mockSermon,
            preachDates: [{
                ...mockSermon.preachDates![0],
                outcome: 'good'
            }]
        };

        render(<AgendaView entries={sermonEntries([goodSermon])} series={[]} />);

        expect(screen.getByText('Good')).toBeInTheDocument();
    });

    it('renders link elements correctly', () => {
        render(<AgendaView entries={sermonEntries([mockSermon])} series={[]} />);

        // Check that the link element exists
        const linkElement = screen.getByTestId('link');
        expect(linkElement).toBeInTheDocument();
        expect(linkElement).toHaveAttribute('href', '/sermons/sermon-1');
        expect(linkElement).toHaveClass('group');
    });

    it('carries a council in the running list, linked to the council itself', () => {
        const council = {
            id: 'k1',
            userId: 'user-1',
            title: 'Совет — Bible Truck',
            date: '2024-01-20',
            status: 'preparing' as const,
            topics: [{ id: 't1', title: 'Контекст', questions: [], options: [] }],
            createdAt: '',
            updatedAt: '',
        };

        render(<AgendaView entries={councilEntries([council])} series={[]} />);

        expect(screen.getByText('Совет — Bible Truck')).toBeInTheDocument();
        // The mocked Link keeps only href and className, so the link itself is the anchor here.
        expect(screen.getByTestId('link')).toHaveAttribute('href', '/care/council/k1');
        expect(screen.getByTestId('council-icon')).toBeInTheDocument();
        // The agenda answers "what is it about", not only "what is it called".
        expect(screen.getByText('Контекст')).toBeInTheDocument();
    });

    it('lists the first few section headings and says how many are left', () => {
        const council = {
            id: 'k2',
            userId: 'u1',
            title: 'Совет с длинной повесткой',
            date: '2026-09-20',
            status: 'preparing' as const,
            topics: Array.from({ length: 8 }, (_, i) => ({
                id: `t${i}`,
                title: `Секция ${i + 1}`,
                questions: [],
                options: [],
            })),
            createdAt: '',
            updatedAt: '',
        };

        render(<AgendaView entries={councilEntries([council])} series={[]} />);

        expect(screen.getByText('Секция 1')).toBeInTheDocument();
        expect(screen.getByText('Секция 6')).toBeInTheDocument();
        expect(screen.queryByText('Секция 7')).not.toBeInTheDocument();
        expect(screen.getByText('ещё 2')).toBeInTheDocument();
    });

    it('draws no section block for a council that has none yet', () => {
        const council = {
            id: 'k3',
            userId: 'u1',
            title: 'Пустой совет',
            date: '2026-09-20',
            status: 'preparing' as const,
            topics: [],
            createdAt: '',
            updatedAt: '',
        };

        render(<AgendaView entries={councilEntries([council])} series={[]} />);

        expect(screen.getByText('Пустой совет')).toBeInTheDocument();
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
});
