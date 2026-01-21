"use client";

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AddSermonToSeriesModal from '@/components/series/AddSermonToSeriesModal';

const mockUseDashboardSermons = jest.fn();
const mockMatchesSermonQuery = jest.fn((..._args: any[]) => true);
const mockTokenizeQuery = jest.fn((..._args: any[]) => []);

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'workspaces.series.detail.selectSermonsTitle': 'Выберите проповеди',
        'workspaces.series.detail.selectSermonsDescription': 'Превью тезиса/мысли, дата и количество заметок помогут быстро ориентироваться.',
        'workspaces.series.actions.addSelected': 'Добавить выбранные',
        'workspaces.series.actions.adding': 'Добавление...',
        'workspaces.series.actions.selectedCount': '{{count}} выбрано',
        'workspaces.series.detail.noSermonsFound': 'Нет проповедей по запросу',
        'workspaces.series.detail.noSermonsAvailable': 'Пока нет проповедей для добавления',
        'workspaces.series.detail.clearSearch': 'Сбросить поиск',
        'dashboard.thoughts': 'thoughts',
        'common.search': 'Search sermons...',
        'common.cancel': 'Cancel',
        'addSermon.createNewSermon': 'Создать новую проповедь',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock the required hooks and components
jest.mock('@/hooks/useDashboardSermons', () => ({
  useDashboardSermons: () => mockUseDashboardSermons(),
}));

jest.mock('@/utils/sermonSearch', () => ({
  matchesSermonQuery: (...args: any[]) => mockMatchesSermonQuery(...args),
  tokenizeQuery: (...args: any[]) => mockTokenizeQuery(...args),
}));

jest.mock('@utils/dateFormatter', () => ({
  formatDate: jest.fn(() => '01.01.2024'),
}));

jest.mock('@/components/AddSermonModal', () => {
  return function MockAddSermonModal({
    isOpen,
    onClose,
    preSelectedSeriesId,
    onNewSermonCreated,
  }: {
    isOpen?: boolean;
    onClose?: () => void;
    preSelectedSeriesId?: string;
    onNewSermonCreated?: (sermon: any) => void;
  }) {
    if (!isOpen) return null;
    return (
      <div data-testid="add-sermon-modal">
        <button onClick={onClose} data-testid="close-add-sermon-modal">
          Close
        </button>
        <button
          onClick={() => onNewSermonCreated?.({
            id: 'new-sermon',
            title: 'New Sermon',
            verse: 'Test Verse',
            userId: 'user-1',
          })}
          data-testid="create-sermon-button"
        >
          Create Sermon
        </button>
        {preSelectedSeriesId && (
          <span data-testid="preselected-series">{preSelectedSeriesId}</span>
        )}
      </div>
    );
  };
});

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderWithProviders = (component: React.ReactElement) => {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>
      {component}
    </QueryClientProvider>
  );
};

describe('AddSermonToSeriesModal', () => {
const defaultProps = {
  onClose: jest.fn(),
  onCreateNewSermon: jest.fn(),
  onAddSermons: jest.fn(),
  currentSeriesSermonIds: [],
  seriesId: 'series-123',
};

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDashboardSermons.mockReturnValue({
      sermons: [
        {
          id: 'sermon-1',
          title: 'Test Sermon 1',
          verse: 'John 3:16',
          date: '2024-01-01T00:00:00.000Z',
          thoughts: [{ text: 'Test thought', id: 'thought-1' }],
          userId: 'user-1',
          seriesId: null,
          isPreached: true,
        },
        {
          id: 'sermon-2',
          title: 'Test Sermon 2',
          verse: 'Romans 8:28',
          date: '2024-01-02T00:00:00.000Z',
          thoughts: [],
          userId: 'user-1',
          seriesId: null,
          isPreached: false,
        },
      ],
      loading: false,
    });
    mockMatchesSermonQuery.mockImplementation(() => true);
    mockTokenizeQuery.mockImplementation(() => []);
  });

  it('renders the modal with correct title and description', () => {
    renderWithProviders(<AddSermonToSeriesModal {...defaultProps} />);

    expect(screen.getByText('Выберите проповеди')).toBeInTheDocument();
    expect(screen.getByText('Превью тезиса/мысли, дата и количество заметок помогут быстро ориентироваться.')).toBeInTheDocument();
  });

  it('renders search input', () => {
    renderWithProviders(<AddSermonToSeriesModal {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText('Search sermons...');
    expect(searchInput).toBeInTheDocument();
  });

  it('renders sermon list with correct information', () => {
    renderWithProviders(<AddSermonToSeriesModal {...defaultProps} />);

    expect(screen.getByText('Test Sermon 1')).toBeInTheDocument();
    expect(screen.getByText('Test Sermon 2')).toBeInTheDocument();
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText('Romans 8:28')).toBeInTheDocument();
    expect(screen.getAllByText('01.01.2024')).toHaveLength(2);
    expect(screen.getByText('dashboard.preached')).toBeInTheDocument();
  });

  it('displays thought count correctly', () => {
    renderWithProviders(<AddSermonToSeriesModal {...defaultProps} />);

    expect(screen.getByText('1 thoughts')).toBeInTheDocument();
    expect(screen.getByText('0 thoughts')).toBeInTheDocument();
  });

  it('filters out sermons already in series', () => {
    const props = {
      ...defaultProps,
      currentSeriesSermonIds: ['sermon-1'],
    };

    renderWithProviders(<AddSermonToSeriesModal {...props} />);

    expect(screen.queryByText('Test Sermon 1')).not.toBeInTheDocument();
    expect(screen.getByText('Test Sermon 2')).toBeInTheDocument();
  });

  it('renders Cancel button', () => {
    renderWithProviders(<AddSermonToSeriesModal {...defaultProps} />);

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    expect(cancelButton).toBeInTheDocument();
  });

  it('calls onCreateNewSermon when Create New Sermon button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddSermonToSeriesModal {...defaultProps} />);

    const createButton = screen.getByRole('button', { name: /Создать новую проповедь/i });
    await user.click(createButton);

    expect(defaultProps.onCreateNewSermon).toHaveBeenCalled();
  });

  it('shows no sermons found and clears search', async () => {
    const user = userEvent.setup();
    mockMatchesSermonQuery.mockImplementation(() => false);

    renderWithProviders(<AddSermonToSeriesModal {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText('Search sermons...');
    await user.type(searchInput, 'nothing');

    expect(screen.getByText('Нет проповедей по запросу')).toBeInTheDocument();

    const clearButton = screen.getByRole('button', { name: 'Сбросить поиск' });
    await user.click(clearButton);

    expect(screen.getByText('Test Sermon 1')).toBeInTheDocument();
    expect(screen.getByText('Test Sermon 2')).toBeInTheDocument();
  });

  it('shows no sermons available when all are already in series', () => {
    const props = {
      ...defaultProps,
      currentSeriesSermonIds: ['sermon-1', 'sermon-2'],
    };

    renderWithProviders(<AddSermonToSeriesModal {...props} />);

    expect(screen.getByText('Пока нет проповедей для добавления')).toBeInTheDocument();
  });

  it('enables add button when a sermon is selected and calls onAddSermons', async () => {
    const user = userEvent.setup();
    const onAddSermons = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    renderWithProviders(
      <AddSermonToSeriesModal
        {...defaultProps}
        onAddSermons={onAddSermons}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('button', { name: /Добавить выбранные/i })).toBeDisabled();

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Добавить выбранные/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /Добавить выбранные/i }));

    expect(onAddSermons).toHaveBeenCalledWith(['sermon-1']);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows loading state when sermons are loading', () => {
    mockUseDashboardSermons.mockReturnValue({
      sermons: [],
      loading: true,
    });

    renderWithProviders(<AddSermonToSeriesModal {...defaultProps} />);

    expect(screen.getByText('workspaces.series.loadingSeries')).toBeInTheDocument();
  });

  it('renders Add Selected button', () => {
    renderWithProviders(<AddSermonToSeriesModal {...defaultProps} />);

    const addButton = screen.getByRole('button', { name: /Добавить выбранные/i });
    expect(addButton).toBeInTheDocument();
  });

  it('disables Add Selected button when no sermons selected', () => {
    renderWithProviders(<AddSermonToSeriesModal {...defaultProps} />);

    const addButton = screen.getByRole('button', { name: /Добавить выбранные/i });
    expect(addButton).toBeDisabled();
  });



});
