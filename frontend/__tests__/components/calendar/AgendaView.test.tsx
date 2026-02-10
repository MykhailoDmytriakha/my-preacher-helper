import { render, screen } from '@testing-library/react';
import React from 'react';
import AgendaView from '@/components/calendar/AgendaView';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

// Mock react-i18next
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, _options?: any) => {
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
        render(<AgendaView sermons={[]} series={[]} />);

        expect(screen.getByText('No preach dates recorded')).toBeInTheDocument();
    });

    it('renders sermon information correctly', () => {
        render(<AgendaView sermons={[mockSermon]} series={[]} />);

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
        render(<AgendaView sermons={[mockSermonWithLongVerse]} series={[]} />);

        const verseElement = screen.getByText(mockSermonWithLongVerse.verse);
        expect(verseElement).toBeInTheDocument();

        // Check that the verse is wrapped in a div with proper multi-line classes
        const verseContainer = verseElement.closest('div');
        expect(verseContainer).toHaveClass('break-words', 'whitespace-pre-line', 'flex-1');

        // Check that parent container has current metadata layout classes
        const parentContainer = verseContainer?.parentElement;
        expect(parentContainer).toHaveClass('flex', 'flex-col', 'gap-2');

        expect(parentContainer).toBeInTheDocument();
    });

    it('renders multiple sermons for same date', () => {
        const anotherSermon = {
            ...mockSermon,
            id: 'sermon-2',
            title: 'Another Sermon'
        };

        render(<AgendaView sermons={[mockSermon, anotherSermon]} series={[]} />);

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

        render(<AgendaView sermons={[goodSermon]} series={[]} />);

        expect(screen.getByText('Good')).toBeInTheDocument();
    });

    it('renders link elements correctly', () => {
        render(<AgendaView sermons={[mockSermon]} series={[]} />);

        // Check that the link element exists
        const linkElement = screen.getByTestId('link');
        expect(linkElement).toBeInTheDocument();
        expect(linkElement).toHaveAttribute('href', '/sermons/sermon-1');
        expect(linkElement).toHaveClass('group');
    });
});
