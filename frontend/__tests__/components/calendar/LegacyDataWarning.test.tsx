import { render, screen } from '@testing-library/react';
import React from 'react';
import LegacyDataWarning from '@/components/calendar/LegacyDataWarning';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

// Mock react-i18next
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: any) => {
            const translations: { [key: string]: string } = {
                'calendar.missingDateWarningTitle': 'Legacy Preaching Data',
                'calendar.missingDateWarningDesc': 'Some of your older sermons are marked as "preached", but do not have specific dates and churches assigned in the new calendar system.',
                'calendar.createdDate': 'Created: {date}',
                'calendar.goToSermon': 'Go to Sermon',
                'calendar.addDateNow': 'Add Date Now',
            };
            const template = translations[key] ?? options?.defaultValue ?? key;
            if (!options) {
                return template;
            }
            return Object.keys(options).reduce((acc, optionKey) => {
                if (optionKey === 'defaultValue') {
                    return acc;
                }
                const value = String(options[optionKey]);
                return acc.replace(`{{${optionKey}}}`, value).replace(`{${optionKey}}`, value);
            }, template);
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

// Mock dateFormatter
jest.mock('@/utils/dateFormatter', () => ({
    formatDate: jest.fn((_date: string | Date) => '1/1/2024')
}));

// Mock heroicons
jest.mock('@heroicons/react/24/outline', () => ({
    ExclamationTriangleIcon: () => <div data-testid="exclamation-icon" />,
    PlusIcon: () => <div data-testid="plus-icon" />,
}));

describe('LegacyDataWarning', () => {
    const mockSermon: Sermon = {
        id: 'sermon-1',
        title: 'Test Sermon',
        verse: 'John 3:16',
        date: '2024-01-01',
        thoughts: [],
        userId: 'user-1',
        isPreached: true,
        preachDates: [] // Empty to trigger legacy data warning
    };

    const mockSermonWithLongVerse: Sermon = {
        ...mockSermon,
        verse: 'Агг 1:5-14: Посему ныне так говорит Господь Саваоф: обратите сердце ваше на пути ваши. Вы сеете много, а собираете мало; едите, но не в сытость; пьете, но не напиваетесь.'
    };

    it('does not render when no pending sermons', () => {
        const { container } = render(
            <LegacyDataWarning
                pendingSermons={[]}
            />
        );

        expect(container.firstChild).toBeNull();
    });

    it('renders warning with sermon information', () => {
        render(
            <LegacyDataWarning
                pendingSermons={[mockSermon]}
            />
        );

        expect(screen.getByText('Legacy Preaching Data')).toBeInTheDocument();
        expect(screen.getByText('Test Sermon')).toBeInTheDocument();
        expect(screen.getByText('John 3:16')).toBeInTheDocument();
        expect(screen.getByText('Created: 1/1/2024')).toBeInTheDocument();
    });

    it('displays long sermon verse', () => {
        render(
            <LegacyDataWarning
                pendingSermons={[mockSermonWithLongVerse]}
            />
        );

        expect(screen.getByText(mockSermonWithLongVerse.verse)).toBeInTheDocument();
    });

    it('renders action buttons', () => {
        const mockOnAddDate = jest.fn();
        render(
            <LegacyDataWarning
                pendingSermons={[mockSermon]}
                onAddDate={mockOnAddDate}
            />
        );

        expect(screen.getByText('Go to Sermon')).toBeInTheDocument();
        expect(screen.getByText('Add Date Now')).toBeInTheDocument();
        expect(screen.getByTestId('plus-icon')).toBeInTheDocument();
    });

    it('handles multiple pending sermons', () => {
        const multipleSermons = [mockSermon, { ...mockSermon, id: 'sermon-2', title: 'Another Sermon' }];

        render(
            <LegacyDataWarning
                pendingSermons={multipleSermons}
                onAddDate={jest.fn()}
            />
        );

        expect(screen.getByText('Test Sermon')).toBeInTheDocument();
        expect(screen.getByText('Another Sermon')).toBeInTheDocument();
    });
});
