import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import SermonCard from '@/components/dashboard/SermonCard';
import { Sermon, Series } from '@/models/models';
import '@testing-library/jest-dom';

// Mock services used by OptionMenu
jest.mock('@services/sermon.service', () => ({
  updateSermon: jest.fn().mockResolvedValue({}),
}));

jest.mock('@services/preachDates.service', () => ({
  deletePreachDate: jest.fn().mockResolvedValue({}),
}));

// Mock Next.js router
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'dashboard.thought': 'thought',
        'dashboard.thoughts': 'thoughts',
        'dashboard.hasOutline': 'Has outline',
        'dashboard.created': 'Created',
        'dashboard.preached': 'Preached',
        'dashboard.plan': 'Plan',
        'dashboard.toStructure': 'To structure',
        'dashboard.goToStructure': 'Go to structure',
        'export.txtTitle': 'TXT',
        'export.soonAvailable': 'export.soonAvailable',
        'optionMenu.options': 'optionMenu.options',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock dateFormatter
jest.mock('@utils/dateFormatter', () => ({
  formatDate: jest.fn(() => '18.02.2025, 11:24'),
  formatDateOnly: jest.fn(() => '18.02.2025'),
}));

// Mock exportContent
jest.mock('@utils/exportContent', () => ({
  getExportContent: jest.fn(() => Promise.resolve('Test export content')),
}));

// Mock @tanstack/react-query
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
}));

describe('SermonCard Component', () => {
  const mockOnDelete = jest.fn();
  const mockOnUpdate = jest.fn();

  const baseSermon: Sermon = {
    id: 'test-sermon-id',
    title: 'Test Sermon Title',
    verse: 'John 3:16',
    date: '2025-02-18',
    thoughts: [
      { id: 'thought-1', text: 'Test thought', date: '2025-02-18', tags: [] }
    ],
    userId: 'test-user-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const optimisticActions = {
    createSermon: jest.fn(),
    saveEditedSermon: jest.fn(),
    deleteSermon: jest.fn(),
    markAsPreachedFromPreferred: jest.fn(),
    unmarkAsPreached: jest.fn(),
    savePreachDate: jest.fn(),
    retrySync: jest.fn(),
    dismissSyncError: jest.fn(),
  };

  it('renders sermon card with basic information', () => {
    render(
      <SermonCard
        sermon={baseSermon}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
      />
    );

    expect(screen.getByText('Test Sermon Title')).toBeInTheDocument();
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText('18.02.2025, 11:24')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Preached')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('displays thought count correctly for singular', () => {
    const sermonWithOneThought: Sermon = {
      ...baseSermon,
      thoughts: [{ id: 'thought-1', text: 'Test thought', date: '2025-02-18', tags: [] }],
    };

    render(
      <SermonCard
        sermon={sermonWithOneThought}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
      />
    );

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('displays thought count correctly for plural', () => {
    const sermonWithMultipleThoughts: Sermon = {
      ...baseSermon,
      thoughts: [
        { id: 'thought-1', text: 'Test thought 1', date: '2025-02-18', tags: [] },
        { id: 'thought-2', text: 'Test thought 2', date: '2025-02-18', tags: [] },
      ],
    };

    render(
      <SermonCard
        sermon={sermonWithMultipleThoughts}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
      />
    );

    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('displays "Has outline" badge when sermon has outline', () => {
    const sermonWithOutline: Sermon = {
      ...baseSermon,
      outline: {
        introduction: [{ id: 'intro-1', text: 'Intro point' }],
        main: [{ id: 'main-1', text: 'Main point' }],
        conclusion: [{ id: 'conclusion-1', text: 'Conclusion point' }],
      },
    };

    render(
      <SermonCard
        sermon={sermonWithOutline}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
      />
    );

    expect(screen.getByText('Has outline')).toBeInTheDocument();
  });

  it('displays "Preached" badge when sermon is preached', () => {
    const preachedSermon: Sermon = {
      ...baseSermon,
      isPreached: true,
    };

    render(
      <SermonCard
        sermon={preachedSermon}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
      />
    );

    expect(screen.getAllByText('Preached')).toHaveLength(2);
  });

  it('applies consistent styling for all sermons regardless of preached status', () => {
    const preachedSermon: Sermon = {
      ...baseSermon,
      isPreached: true,
    };

    render(
      <SermonCard
        sermon={preachedSermon}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
      />
    );

    const card = screen.getByTestId(`sermon-card-${preachedSermon.id}`);
    expect(card).toHaveClass('bg-white', 'dark:bg-gray-800');
  });

  it('applies consistent styling for non-preached sermons', () => {
    const nonPreachedSermon: Sermon = {
      ...baseSermon,
      isPreached: false,
    };

    render(
      <SermonCard
        sermon={nonPreachedSermon}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
      />
    );

    const card = screen.getByTestId(`sermon-card-${nonPreachedSermon.id}`);
    expect(card).toHaveClass('bg-white', 'dark:bg-gray-800');
  });

  it('displays series badge when sermon has seriesId', () => {
    const sermonWithSeries: Sermon = {
      ...baseSermon,
      seriesId: 'test-series-id',
    };

    const series: Series[] = [
      {
        id: 'test-series-id',
        title: 'Test Series',
        color: '#FF0000',
        userId: 'test-user-id',
        theme: 'Test Theme',
        bookOrTopic: 'Romans',
        sermonIds: ['test-sermon-id'],
        status: 'active',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      },
    ];

    render(
      <SermonCard
        sermon={sermonWithSeries}
        series={series}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
      />
    );

    expect(screen.getByText('Test Series')).toBeInTheDocument();
  });

  it('renders export buttons with icon variant', () => {
    render(
      <SermonCard
        sermon={baseSermon}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
      />
    );

    // Check that export buttons are rendered (they should be icon variant in the footer)
    const exportButtons = screen.getAllByRole('button').filter(button =>
      button.querySelector('svg') && !button.textContent?.trim()
    );
    expect(exportButtons.length).toBeGreaterThan(0);
  });

  it.each([
    ['create', 'addSermon.newSermon'],
    ['delete', 'optionMenu.delete'],
    ['preach-status', 'optionMenu.markAsPreached'],
    ['update', 'editSermon.editSermon'],
  ] as const)('renders sync operation label for %s state', (operation, labelKey) => {
    render(
      <SermonCard
        sermon={baseSermon}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
        syncState={{ status: 'pending', operation }}
      />
    );

    expect(screen.getByText(labelKey)).toBeInTheDocument();
  });

  it('renders pending sync badge and pending visual card style', () => {
    render(
      <SermonCard
        sermon={baseSermon}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
        syncState={{ status: 'pending', operation: 'update' }}
      />
    );

    expect(screen.getByText('buttons.saving')).toBeInTheDocument();
    const card = screen.getByTestId(`sermon-card-${baseSermon.id}`);
    expect(card).toHaveClass('opacity-75');
    expect(card).toHaveClass('border-blue-200');
  });

  it('renders error sync badge and triggers retry/dismiss handlers', () => {
    render(
      <SermonCard
        sermon={baseSermon}
        onDelete={mockOnDelete}
        onUpdate={mockOnUpdate}
        syncState={{ status: 'error', operation: 'update' }}
        optimisticActions={optimisticActions as any}
      />
    );

    const retryButton = screen.getByText('buttons.retry');
    const dismissButton = screen.getByText('buttons.dismiss');

    fireEvent.click(retryButton);
    fireEvent.click(dismissButton);

    expect(optimisticActions.retrySync).toHaveBeenCalledWith(baseSermon.id);
    expect(optimisticActions.dismissSyncError).toHaveBeenCalledWith(baseSermon.id);

    const card = screen.getByTestId(`sermon-card-${baseSermon.id}`);
    expect(card).toHaveClass('border-red-300');
  });
});
