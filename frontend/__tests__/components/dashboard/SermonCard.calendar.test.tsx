import { render, screen } from '@testing-library/react';
import React from 'react';
import SermonCard from '@/components/dashboard/SermonCard';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

// Mock Next.js router
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
    }),
}));

// Mock react-i18next
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const translations: { [key: string]: string } = {
                'calendar.noPreachDatesWarning': 'Missing preach dates',
                'dashboard.created': 'Created',
                'dashboard.preached': 'Preached',
            };
            return translations[key] || key;
        },
    }),
}));

// Mock components
jest.mock('@/components/dashboard/OptionMenu', () => () => <div data-testid="option-menu" />);
jest.mock('@components/ExportButtons', () => () => <div data-testid="export-buttons" />);
jest.mock('@/components/dashboard/QuickPlanAccessButton', () => ({
    QuickPlanAccessButton: () => <div data-testid="quick-plan-button" />
}));

describe('SermonCard Calendar Integration', () => {
    const baseSermon: Sermon = {
        id: 'sermon-1',
        title: 'Test Sermon',
        verse: 'Verse 1',
        date: '2023-10-27',
        thoughts: [],
        userId: 'user-1',
        isPreached: true,
    };

    it('displays warning when sermon is preached but has no preachDates', () => {
        render(
            <SermonCard
                sermon={{ ...baseSermon, preachDates: [] }}
                onDelete={jest.fn()}
                onUpdate={jest.fn()}
            />
        );

        expect(screen.getByText('Missing preach dates')).toBeInTheDocument();
    });

    it('does not display warning when sermon is preached and has preachDates', () => {
        const sermonWithDates: Sermon = {
            ...baseSermon,
            preachDates: [{ id: 'd1', date: '2023-10-27', church: { id: 'c1', name: 'Z' }, createdAt: '...' }]
        };

        render(
            <SermonCard
                sermon={sermonWithDates}
                onDelete={jest.fn()}
                onUpdate={jest.fn()}
            />
        );

        expect(screen.queryByText('Missing preach dates')).not.toBeInTheDocument();
    });

    it('does not display warning when sermon is not preached', () => {
        render(
            <SermonCard
                sermon={{ ...baseSermon, isPreached: false }}
                onDelete={jest.fn()}
                onUpdate={jest.fn()}
            />
        );

        expect(screen.queryByText('Missing preach dates')).not.toBeInTheDocument();
    });
});
