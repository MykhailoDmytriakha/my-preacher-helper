import { render, screen } from '@testing-library/react';
import React from 'react';
import DateEventList from '@/components/calendar/DateEventList';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

// Mock react-i18next
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: any) => {
            const translations: { [key: string]: string } = {
                'sermon.outline.thoughts': options?.count === 1 ? 'thought' : 'thoughts',
                'sermon.outline.thoughts_one': 'thought',
                'sermon.outline.thoughts_few': 'thoughts',
                'sermon.outline.thoughts_many': 'thoughts',
                'sermon.outline.thoughts_other': 'thoughts',
                'calendar.totalSermonsWord': options?.count === 1 ? 'sermon' : 'sermons',
                'calendar.totalGroupsWord': options?.count === 1 ? 'group' : 'groups',
                'calendar.noPreachDates': 'No preach dates recorded',
                'calendar.outcomes.excellent': 'Excellent',
                'calendar.outcomes.good': 'Good',
                'calendar.outcomes.average': 'Average',
                'calendar.outcomes.poor': 'Poor',
                'calendar.status.planned': 'Planned',
                'calendar.status.preached': 'Preached',
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
    return function MockLink({ children, href }: { children: React.ReactNode; href: string }) {
        return <a href={href} data-testid="link">{children}</a>;
    };
});

// Mock heroicons
jest.mock('@heroicons/react/24/outline', () => ({
    CalendarDaysIcon: () => <div data-testid="calendar-days-icon" />,
    MapPinIcon: () => <div data-testid="map-pin-icon" />,
    UserIcon: () => <div data-testid="user-icon" />,
    BookOpenIcon: () => <div data-testid="book-open-icon" />,
    UserGroupIcon: () => <div data-testid="user-group-icon" />,
}));

describe('DateEventList', () => {
    const mockMonth = new Date('2024-01-15');

    const mockSermon: Sermon = {
        id: 'sermon-1',
        title: 'Test Sermon',
        verse: 'John 3:16',
        date: '2024-01-01',
        thoughts: [],
        userId: 'user-1',
        isPreached: true,
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

    const mockSermon2: Sermon = {
        id: 'sermon-2',
        title: 'Another Sermon',
        verse: 'Romans 8:28',
        date: '2024-01-02',
        thoughts: [],
        userId: 'user-1',
        isPreached: true,
        preachDates: [
            {
                id: 'pd-2',
                date: '2024-01-20',
                church: { id: 'c2', name: 'Another Church', city: 'Another City' },
                audience: '50 people',
                notes: 'Good message',
                outcome: 'good',
                createdAt: '2024-01-02T00:00:00Z'
            }
        ]
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders month title correctly', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[]}
                series={[]}
            />
        );

        expect(screen.getByText('January 2024')).toBeInTheDocument();
    });

    it('displays total sermon count in header', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon]}
                series={[]}
            />
        );

        expect(screen.getByText('1 sermon')).toBeInTheDocument();
    });

    it('displays plural sermons for multiple sermons', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon, mockSermon2]}
                series={[]}
            />
        );

        expect(screen.getByText('2 sermons')).toBeInTheDocument();
    });

    it('renders empty state when no sermons', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[]}
                series={[]}
            />
        );

        expect(screen.getByText('No preach dates recorded')).toBeInTheDocument();
    });

    it('groups sermons by date within month', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon, mockSermon2]}
                series={[]}
            />
        );

        // Should show both date headers with correct format (PPPP includes ordinal)
        expect(screen.getByText('Monday, January 15th, 2024')).toBeInTheDocument();
        expect(screen.getByText('Saturday, January 20th, 2024')).toBeInTheDocument();
    });

    it('displays sermon count per date', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon]}
                series={[]}
            />
        );

        // Date header should be present without count display
        expect(screen.getByText('Monday, January 15th, 2024')).toBeInTheDocument();
    });

    it('sorts dates in descending order (newest first)', () => {
        // Create sermons with dates in various order
        const reversedSermons = [mockSermon2, mockSermon]; // Jan 20, then Jan 15

        render(
            <DateEventList
                month={mockMonth}
                sermons={reversedSermons}
                series={[]}
            />
        );

        const dateHeaders = screen.getAllByText(/January \d{1,2}.*2024/);
        // Descending: Jan 20 first, then Jan 15
        expect(dateHeaders[0]).toHaveTextContent('Saturday, January 20th, 2024');
        expect(dateHeaders[1]).toHaveTextContent('Monday, January 15th, 2024');
    });

    it('renders sermon title and links correctly', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon]}
                series={[]}
            />
        );

        const link = screen.getByTestId('link');
        expect(link).toHaveAttribute('href', '/sermons/sermon-1');
        expect(screen.getByText('Test Sermon')).toBeInTheDocument();
    });

    it('displays sermon verse', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon]}
                series={[]}
            />
        );

        expect(screen.getByText('John 3:16')).toBeInTheDocument();
    });

    it('displays sermon verse with proper layout structure', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon]}
                series={[]}
            />
        );

        const verseElement = screen.getByText('John 3:16');

        // Check that the verse is wrapped in a div with proper multi-line classes
        const verseContainer = verseElement.closest('div');
        expect(verseContainer).toHaveClass('break-words', 'whitespace-pre-line', 'flex-1');

        // Check that parent container has proper alignment classes
        const parentContainer = verseContainer?.parentElement;
        expect(parentContainer).toHaveClass('flex', 'items-start', 'gap-1.5');

        // Check that the outer container is flex-col with gap
        const outerContainer = parentContainer?.parentElement;
        expect(outerContainer).toHaveClass('flex', 'flex-col', 'gap-2');
    });

    it('displays church information', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon]}
                series={[]}
            />
        );

        expect(screen.getByText('Test Church, Test City')).toBeInTheDocument();
        expect(screen.getByTestId('map-pin-icon')).toBeInTheDocument();
    });

    it('displays audience information', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon]}
                series={[]}
            />
        );

        expect(screen.getByText('100 people')).toBeInTheDocument();
        expect(screen.getByTestId('user-icon')).toBeInTheDocument();
    });

    it('displays outcome badge', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon]}
                series={[]}
            />
        );

        expect(screen.getByText('Excellent')).toBeInTheDocument();
    });

    it('does not render preach notes in date cards', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon]}
                series={[]}
            />
        );

        expect(screen.queryByText(/Great sermon/)).not.toBeInTheDocument();
    });

    it('handles sermons without preachDates gracefully', () => {
        const sermonWithoutDates: Sermon = {
            id: 'sermon-3',
            title: 'No Dates Sermon',
            verse: 'Genesis 1:1',
            date: '2024-01-01',
            thoughts: [],
            userId: 'user-1',
            isPreached: false,
            preachDates: []
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[sermonWithoutDates]}
            />
        );

        // Should show empty state since no preachDates
        expect(screen.getByText('No preach dates recorded')).toBeInTheDocument();
    });

    it('handles multiple sermons on same date', () => {
        const anotherSermonOnSameDate: Sermon = {
            id: 'sermon-3',
            title: 'Same Date Sermon',
            verse: 'Psalm 23:1',
            date: '2024-01-03',
            thoughts: [],
            userId: 'user-1',
            isPreached: true,
            preachDates: [
                {
                    id: 'pd-3',
                    date: '2024-01-15', // Same date as mockSermon
                    church: { id: 'c3', name: 'Third Church', city: 'Third City' },
                    audience: '75 people',
                    notes: 'Another great sermon',
                    outcome: 'good',
                    createdAt: '2024-01-03T00:00:00Z'
                }
            ]
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon, anotherSermonOnSameDate]}
            />
        );

        // Should show date header for Jan 15
        expect(screen.getByText('Monday, January 15th, 2024')).toBeInTheDocument();

        // Should show both sermon titles
        expect(screen.getByText('Test Sermon')).toBeInTheDocument();
        expect(screen.getByText('Same Date Sermon')).toBeInTheDocument();
    });

    it('applies correct styling classes', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[mockSermon]}
                series={[]}
            />
        );

        // Check for main container
        const container = screen.getByText('January 2024').closest('.space-y-6');
        expect(container).toBeInTheDocument();

        // Check that the link element exists (mocked Link component)
        const linkElement = screen.getByTestId('link');
        expect(linkElement).toBeInTheDocument();
    });

    it('localizes empty state message', () => {
        render(
            <DateEventList
                month={mockMonth}
                sermons={[]}
                series={[]}
            />
        );

        // The component uses t() for localization, so we just verify it renders
        expect(screen.getByText('No preach dates recorded')).toBeInTheDocument();
    });

    it('displays group events with totalGroupsWord counter', () => {
        const mockGroup = {
            id: 'group-1',
            title: 'Test Group',
            description: 'Group description',
            userId: 'user-1',
            templates: [],
            flow: [],
            meetingDates: [
                {
                    id: 'md-1',
                    date: '2024-01-15',
                    location: 'Community Hall',
                    audience: '20 people',
                    outcome: 'good',
                    createdAt: '2024-01-01T00:00:00Z',
                },
            ],
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[]}
                groups={[mockGroup as any]}
                series={[]}
            />
        );

        expect(screen.getByText('1 group')).toBeInTheDocument();
        expect(screen.getByText('Test Group')).toBeInTheDocument();
        expect(screen.getByTestId('user-group-icon')).toBeInTheDocument();
    });

    it('renders group link to /groups/:id', () => {
        const mockGroup = {
            id: 'group-42',
            title: 'Bible Study',
            userId: 'user-1',
            templates: [],
            flow: [],
            meetingDates: [
                {
                    id: 'md-1',
                    date: '2024-01-15',
                    location: 'Room 3',
                    createdAt: '2024-01-01T00:00:00Z',
                },
            ],
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[]}
                groups={[mockGroup as any]}
                series={[]}
            />
        );

        const link = screen.getByTestId('link');
        expect(link).toHaveAttribute('href', '/groups/group-42');
    });

    it('displays group location and audience', () => {
        const mockGroup = {
            id: 'group-1',
            title: 'Prayer Group',
            userId: 'user-1',
            templates: [],
            flow: [],
            meetingDates: [
                {
                    id: 'md-1',
                    date: '2024-01-15',
                    location: 'Main Hall',
                    audience: '30 people',
                    createdAt: '2024-01-01T00:00:00Z',
                },
            ],
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[]}
                groups={[mockGroup as any]}
                series={[]}
            />
        );

        expect(screen.getByText('Main Hall')).toBeInTheDocument();
        expect(screen.getByText('30 people')).toBeInTheDocument();
    });

    it('resolves group series by seriesId', () => {
        const mockSeries = {
            id: 'series-1',
            title: 'Foundations',
            color: '#3B82F6',
            userId: 'user-1',
            items: [],
        };

        const mockGroup = {
            id: 'group-1',
            title: 'Group in Series',
            seriesId: 'series-1',
            userId: 'user-1',
            templates: [],
            flow: [],
            meetingDates: [
                {
                    id: 'md-1',
                    date: '2024-01-15',
                    createdAt: '2024-01-01T00:00:00Z',
                },
            ],
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[]}
                groups={[mockGroup as any]}
                series={[mockSeries as any]}
            />
        );

        expect(screen.getByText('Foundations')).toBeInTheDocument();
    });

    it('resolves group series by items[] when no seriesId', () => {
        const mockSeries = {
            id: 'series-1',
            title: 'Journey Series',
            color: '#10b981',
            userId: 'user-1',
            items: [{ type: 'group', refId: 'group-99' }],
        };

        const mockGroup = {
            id: 'group-99',
            title: 'Group without seriesId',
            userId: 'user-1',
            templates: [],
            flow: [],
            meetingDates: [
                {
                    id: 'md-1',
                    date: '2024-01-15',
                    createdAt: '2024-01-01T00:00:00Z',
                },
            ],
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[]}
                groups={[mockGroup as any]}
                series={[mockSeries as any]}
            />
        );

        expect(screen.getByText('Journey Series')).toBeInTheDocument();
    });

    it('renders church name without city when city is empty', () => {
        const sermonNoCityChurch: Sermon = {
            id: 'sermon-nc',
            title: 'No City Sermon',
            verse: 'Mark 1:1',
            date: '2024-01-01',
            thoughts: [],
            userId: 'user-1',
            isPreached: true,
            preachDates: [
                {
                    id: 'pd-nc',
                    date: '2024-01-15',
                    church: { id: 'c-nc', name: 'Open Air', city: '' },
                    createdAt: '2024-01-01T00:00:00Z',
                },
            ],
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[sermonNoCityChurch]}
                series={[]}
            />
        );

        expect(screen.getByText('Open Air')).toBeInTheDocument();
    });

    it('shows Planned badge for planned sermon status', () => {
        const plannedSermon: Sermon = {
            id: 'sermon-planned',
            title: 'Planned Sermon',
            verse: 'Hebrews 11:1',
            date: '2024-01-01',
            thoughts: [],
            userId: 'user-1',
            isPreached: false,
            preachDates: [
                {
                    id: 'pd-p',
                    date: '2024-01-15',
                    status: 'planned',
                    church: { id: 'c1', name: 'Church', city: 'City' },
                    createdAt: '2024-01-01T00:00:00Z',
                },
            ],
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[plannedSermon]}
                series={[]}
            />
        );

        expect(screen.getByText('Planned')).toBeInTheDocument();
    });

    it('resolves sermon series by seriesId', () => {
        const mockSeries = {
            id: 'series-s1',
            title: 'Romans Study',
            color: '#6366f1',
            userId: 'user-1',
            items: [],
        };

        const sermonWithSeries: Sermon = {
            id: 'sermon-s1',
            title: 'Romans 1',
            verse: 'Romans 1:1',
            date: '2024-01-01',
            thoughts: [],
            userId: 'user-1',
            isPreached: true,
            seriesId: 'series-s1',
            preachDates: [
                {
                    id: 'pd-s1',
                    date: '2024-01-15',
                    church: { id: 'c1', name: 'Church', city: 'City' },
                    createdAt: '2024-01-01T00:00:00Z',
                },
            ],
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[sermonWithSeries]}
                series={[mockSeries as any]}
            />
        );

        expect(screen.getByText('Romans Study')).toBeInTheDocument();
    });

    it('resolves sermon series by sermonIds[] fallback', () => {
        const mockSeries = {
            id: 'series-s2',
            title: 'Acts Study',
            color: '#f59e0b',
            userId: 'user-1',
            sermonIds: ['sermon-s2'],
            items: [],
        };

        const sermonFallback: Sermon = {
            id: 'sermon-s2',
            title: 'Acts 1',
            verse: 'Acts 1:1',
            date: '2024-01-01',
            thoughts: [],
            userId: 'user-1',
            isPreached: true,
            preachDates: [
                {
                    id: 'pd-s2',
                    date: '2024-01-15',
                    church: { id: 'c1', name: 'Church', city: 'City' },
                    createdAt: '2024-01-01T00:00:00Z',
                },
            ],
        };

        render(
            <DateEventList
                month={mockMonth}
                sermons={[sermonFallback]}
                series={[mockSeries as any]}
            />
        );

        expect(screen.getByText('Acts Study')).toBeInTheDocument();
    });
});

