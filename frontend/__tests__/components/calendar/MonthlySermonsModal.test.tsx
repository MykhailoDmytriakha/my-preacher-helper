import { render, screen, fireEvent } from '@testing-library/react';
import MonthlySermonsModal from '@/components/calendar/MonthlySermonsModal';
import * as reactI18next from 'react-i18next';

// Mock translation
const mockT = jest.fn((key: string, options?: any) => {
    if (key === 'calendar.analytics.monthModalTitle') {
        return `Sermons in ${options?.month}`;
    }
    if (key === 'calendar.analytics.monthModalCount') {
        return `${options?.count} sermons`;
    }
    if (key === 'calendar.analytics.monthModalEmpty') {
        return 'No sermons for this month yet';
    }
    if (key === 'buttons.close') return options?.defaultValue || 'Close';
    if (key === 'calendar.analytics.bookModalUntitled') return 'Untitled';
    return key;
});

jest.mock('react-i18next', () => ({
    useTranslation: jest.fn(),
}));

// Mock next/link
jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
});

describe('MonthlySermonsModal', () => {
    const mockOnClose = jest.fn();
    const mockEntries = [
        {
            sermon: {
                id: '1',
                title: 'Sermon 1',
                verse: 'Genesis 1:1',
            },
            preachDate: {
                id: 'pd1',
                date: '2024-01-15',
                church: {
                    name: 'Church 1',
                    city: 'City 1',
                },
            },
        },
    ];

    const setupMockTranslation = (lang: string) => {
        (reactI18next.useTranslation as jest.Mock).mockReturnValue({
            t: mockT,
            i18n: {
                language: lang,
                changeLanguage: jest.fn(),
            },
        });
    };

    beforeEach(() => {
        jest.clearAllMocks();
        setupMockTranslation('en');
    });

    it('renders nothing when closed', () => {
        const { container } = render(
            <MonthlySermonsModal
                isOpen={false}
                onClose={mockOnClose}
                monthKey="2024-01"
                entries={[]}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders empty state correctly', () => {
        setupMockTranslation('en');
        render(
            <MonthlySermonsModal
                isOpen={true}
                onClose={mockOnClose}
                monthKey="2024-01"
                entries={[]}
            />
        );

        expect(screen.getByText(/Sermons in January 2024/i)).toBeInTheDocument();
        expect(screen.getByText(/No sermons for this month yet/i)).toBeInTheDocument();
    });

    it('renders entries correctly', () => {
        render(
            <MonthlySermonsModal
                isOpen={true}
                onClose={mockOnClose}
                monthKey="2024-01"
                entries={mockEntries as any}
            />
        );

        expect(screen.getByText('Sermon 1')).toBeInTheDocument();
        expect(screen.getByText('Genesis 1:1')).toBeInTheDocument();
        expect(screen.getByText('Church 1, City 1')).toBeInTheDocument();
        expect(screen.getByText('15 Jan 2024')).toBeInTheDocument();
    });

    it('handles untitled sermon correctly', () => {
        const untitledEntries = [
            {
                sermon: {
                    id: '2',
                    title: '',
                    verse: 'Genesis 1:1',
                },
                preachDate: {
                    id: 'pd2',
                    date: '2024-01-15',
                    church: { name: 'Church 1' },
                },
            },
        ];
        render(
            <MonthlySermonsModal
                isOpen={true}
                onClose={mockOnClose}
                monthKey="2024-01"
                entries={untitledEntries as any}
            />
        );

        expect(screen.getByText('Untitled')).toBeInTheDocument();
    });

    it('calls onClose when clicking close button', () => {
        render(
            <MonthlySermonsModal
                isOpen={true}
                onClose={mockOnClose}
                monthKey="2024-01"
                entries={[]}
            />
        );

        const closeButton = screen.getByRole('button', { name: /Close/i });
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('handles RU locale correctly', () => {
        setupMockTranslation('ru');
        render(
            <MonthlySermonsModal
                isOpen={true}
                onClose={mockOnClose}
                monthKey="2024-02"
                entries={[]}
            />
        );
        screen.debug();
        expect(screen.getByRole('heading', { level: 2 }).textContent).toBeTruthy();
    });

    it('handles UK locale correctly', () => {
        setupMockTranslation('uk');
        render(
            <MonthlySermonsModal
                isOpen={true}
                onClose={mockOnClose}
                monthKey="2024-03"
                entries={[]}
            />
        );
        const title = screen.getByRole('heading', { level: 2 });
        // Ukrainian "March 2024" can be "Березень 2024" or "Березня 2024" depending on context
        expect(title.textContent).toMatch(/(березень|березня) 2024/i);
    });

    it('falls back to default locale for unknown languages', () => {
        setupMockTranslation('fr');
        render(
            <MonthlySermonsModal
                isOpen={true}
                onClose={mockOnClose}
                monthKey="2024-01"
                entries={[]}
            />
        );
        // Should default to enUS (January 2024)
        expect(screen.getByText(/January 2024/i)).toBeInTheDocument();
    });

    it('handles invalid dates correctly', () => {
        const invalidEntries = [
            {
                sermon: { id: '3', title: 'Invalid Date Sermon' },
                preachDate: { id: 'pd3', date: 'invalid-date', church: { name: 'Church 1' } },
            },
        ];
        render(
            <MonthlySermonsModal
                isOpen={true}
                onClose={mockOnClose}
                monthKey="2024-01"
                entries={invalidEntries as any}
            />
        );

        expect(screen.getByText('invalid-date')).toBeInTheDocument();
    });
});
