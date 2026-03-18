import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import PrayerPage from '@/(pages)/(private)/prayers/page';
import '@testing-library/jest-dom';

const mockUsePrayerRequests = jest.fn();
const mockToastSuccess = jest.fn();

const queryStateDefaults: Record<string, string> = {
  filter: 'active',
  sort: 'updatedAt',
  q: '',
};

jest.mock('@headlessui/react', () => {
  const React = require('react');

  const Popover: any = ({ children }: any) => (
    <div>{typeof children === 'function' ? children({ open: false }) : children}</div>
  );
  const PopoverButton = ({ children, ...props }: any) => <button {...props}>{children}</button>;
  const PopoverPanel = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  const Transition = ({ children }: any) => <>{children}</>;

  return { Popover, PopoverButton, PopoverPanel, Transition };
});

jest.mock('nuqs', () => {
  const React = require('react');

  return {
    useQueryState: (key: string, options: { defaultValue: string }) => {
      const initialValue = queryStateDefaults[key] ?? options.defaultValue;
      const [value, setValue] = React.useState(initialValue);

      return [
        value,
        (nextValue: string) => {
          queryStateDefaults[key] = nextValue;
          setValue(nextValue);
          return Promise.resolve(nextValue);
        },
      ];
    },
  };
});

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'user-1' },
  }),
}));

jest.mock('@/hooks/usePrayerRequests', () => ({
  usePrayerRequests: () => mockUsePrayerRequests(),
}));

jest.mock('@/components/prayer/PrayerRequestCard', () => {
  return ({ prayer, onSetStatus, onDelete, onAddUpdate, onEdit, searchQuery }: any) => (
    <div
      data-testid={`prayer-card-${prayer.id}`}
      data-search-query={searchQuery}
    >
      <span>{prayer.title}</span>
      <button onClick={() => onSetStatus(prayer.id, 'not_answered')}>set-not-answered-{prayer.id}</button>
      <button onClick={() => onSetStatus(prayer.id, 'answered')}>set-answered-{prayer.id}</button>
      <button onClick={() => onDelete(prayer.id)}>delete-{prayer.id}</button>
      <button onClick={() => onAddUpdate(prayer.id)}>add-update-{prayer.id}</button>
      <button onClick={() => onEdit(prayer)}>edit-{prayer.id}</button>
    </div>
  );
});

jest.mock('@/components/prayer/CreatePrayerModal', () => ({
  __esModule: true,
  default: ({ mode = 'create', onSubmit, onClose }: any) => (
    <div data-testid={`${mode}-prayer-modal`}>
      <button
        onClick={async () => {
          await onSubmit({
            title: mode === 'edit' ? 'Edited prayer' : 'Created prayer',
            description: 'Context',
            tags: ['hope'],
          });
          onClose();
        }}
      >
        submit {mode}
      </button>
    </div>
  ),
}));

jest.mock('@/components/prayer/AddUpdateModal', () => ({
  __esModule: true,
  default: ({ onSubmit, onClose }: any) => (
    <div data-testid="add-update-modal">
      <button
        onClick={async () => {
          await onSubmit('Fresh note');
          onClose();
        }}
      >
        submit update
      </button>
    </div>
  ),
}));

jest.mock('@/components/prayer/MarkAnsweredModal', () => ({
  __esModule: true,
  default: ({ onSubmit, onClose }: any) => (
    <div data-testid="mark-answered-modal">
      <button
        onClick={async () => {
          await onSubmit('Answer text');
          onClose();
        }}
      >
        submit answer
      </button>
    </div>
  ),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'prayer.title': 'Prayer Journal',
        'prayer.add': 'Add Prayer',
        'prayer.filter.label': 'Prayer status filters',
        'prayer.filter.all': 'All',
        'prayer.filter.active': 'Active',
        'prayer.filter.answered': 'Answered',
        'prayer.filter.not_answered': 'Not Answered',
        'prayer.sort.label': 'Sort',
        'prayer.sort.updatedAt': 'Recently Updated',
        'prayer.sort.createdAt': 'Date Added',
        'prayer.sort.answeredAt': 'Date Answered',
        'prayer.search.placeholder': 'Search prayers...',
        'prayer.search.settings': 'Search settings',
        'prayer.search.inUpdates': 'Search in updates',
        'prayer.search.inTags': 'Search in tags',
        'prayer.search.inAnswers': 'Search in answers',
        'prayer.empty': 'No prayer requests yet',
        'prayer.emptyFiltered': 'No prayers match this filter',
        'prayer.toast.created': 'Prayer created',
        'prayer.toast.updated': 'Prayer updated',
        'prayer.toast.deleted': 'Prayer deleted',
        'prayer.toast.statusChanged': 'Prayer status changed',
        'prayer.toast.updateAdded': 'Update added',
        'dashboard.searchPanel.title': 'Search & Filters',
        'dashboard.clearSearch': 'Clear search',
        'filters.resetFilters': 'Reset filters',
        'filters.clear': 'Clear all',
        'common.filters': 'Filters',
      };

      return translations[key] || key;
    },
  }),
}));

describe('Prayer Page', () => {
  const createPrayer = jest.fn();
  const updatePrayer = jest.fn();
  const deletePrayer = jest.fn();
  const addUpdate = jest.fn();
  const setStatus = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    queryStateDefaults.filter = 'active';
    queryStateDefaults.sort = 'updatedAt';
    queryStateDefaults.q = '';
    window.localStorage.clear();

    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [
        {
          id: 'active-1',
          userId: 'user-1',
          title: 'Pray for church',
          description: 'Sunday service',
          status: 'active',
          tags: ['church'],
          updates: [{ id: 'u-1', text: 'Met with the team', createdAt: '2026-03-17T10:00:00.000Z' }],
          createdAt: '2026-03-10T09:00:00.000Z',
          updatedAt: '2026-03-17T10:00:00.000Z',
        },
        {
          id: 'answered-1',
          userId: 'user-1',
          title: 'Pray for job',
          description: 'Interview',
          status: 'answered',
          tags: ['work'],
          updates: [{ id: 'u-2', text: 'Interview completed', createdAt: '2026-03-18T12:00:00.000Z' }],
          createdAt: '2026-03-12T09:00:00.000Z',
          updatedAt: '2026-03-18T12:00:00.000Z',
          answeredAt: '2026-03-18T12:00:00.000Z',
          answerText: 'Received the offer',
        },
      ],
      loading: false,
      createPrayer,
      updatePrayer,
      deletePrayer,
      addUpdate,
      setStatus,
    });
  });

  const getAnsweredTabButton = () =>
    screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('Answered'));

  it('hides answer-date sorting while viewing active prayers', () => {
    render(<PrayerPage />);

    expect(screen.getByRole('heading', { name: 'Prayer Journal' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Recently Updated' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Date Added' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Date Answered' })).not.toBeInTheDocument();
    expect(screen.getByTestId('prayer-card-active-1')).toBeInTheDocument();
    expect(screen.queryByTestId('prayer-card-answered-1')).not.toBeInTheDocument();
  });

  it('enables answer-date sorting on answered tab and resets to it', async () => {
    render(<PrayerPage />);

    fireEvent.click(getAnsweredTabButton() as HTMLElement);

    expect(screen.getByRole('combobox')).toHaveValue('answeredAt');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Date Answered' })).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toHaveValue('answeredAt');
      expect(screen.getByTestId('prayer-card-answered-1')).toBeInTheDocument();
      expect(screen.queryByTestId('prayer-card-active-1')).not.toBeInTheDocument();
    });
  });

  it('searches answer text only when the answer scope is enabled', async () => {
    render(<PrayerPage />);

    fireEvent.click(getAnsweredTabButton() as HTMLElement);

    await waitFor(() => {
      expect(screen.getByTestId('prayer-card-answered-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Search in answers'));
    fireEvent.click(screen.getByRole('button', { name: 'Search prayers...' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'offer' } });

    await waitFor(() => {
      expect(screen.getByText('No prayers match this filter')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Search in answers'));

    await waitFor(() => {
      expect(screen.getByTestId('prayer-card-answered-1')).toBeInTheDocument();
    });
  });

  it('passes the active search query into prayer cards for highlighting', async () => {
    render(<PrayerPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search prayers...' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'church' } });

    await waitFor(() => {
      expect(screen.getByTestId('prayer-card-active-1')).toHaveAttribute('data-search-query', 'church');
    });
  });

  it('handles create, edit, delete, update, and status flows through the page callbacks', async () => {
    createPrayer.mockResolvedValue(undefined);
    updatePrayer.mockResolvedValue(undefined);
    deletePrayer.mockResolvedValue(undefined);
    addUpdate.mockResolvedValue(undefined);
    setStatus.mockResolvedValue(undefined);

    render(<PrayerPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Prayer' }));
    fireEvent.click(screen.getByRole('button', { name: 'submit create' }));

    fireEvent.click(screen.getByRole('button', { name: 'edit-active-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'submit edit' }));

    fireEvent.click(screen.getByRole('button', { name: 'delete-active-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'add-update-active-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'submit update' }));

    fireEvent.click(screen.getByRole('button', { name: 'set-not-answered-active-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'set-answered-active-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'submit answer' }));

    await waitFor(() => {
      expect(createPrayer).toHaveBeenCalledWith({
        userId: 'user-1',
        title: 'Created prayer',
        description: 'Context',
        tags: ['hope'],
      });
      expect(updatePrayer).toHaveBeenCalledWith('active-1', {
        title: 'Edited prayer',
        description: 'Context',
        tags: ['hope'],
      });
      expect(deletePrayer).toHaveBeenCalledWith('active-1');
      expect(addUpdate).toHaveBeenCalledWith('active-1', 'Fresh note');
      expect(setStatus).toHaveBeenCalledWith('active-1', 'not_answered');
      expect(setStatus).toHaveBeenCalledWith('active-1', 'answered', 'Answer text');
    });

    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer created');
    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer updated');
    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer deleted');
    expect(mockToastSuccess).toHaveBeenCalledWith('Update added');
    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer status changed');
  });

  it('resets filters after sort and scope changes, and collapses an empty search on blur', async () => {
    const removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem');

    render(<PrayerPage />);

    const searchToggle = screen.getByRole('button', { name: 'Search prayers...' });
    fireEvent.click(searchToggle);

    const searchBox = screen.getByRole('searchbox');
    expect(searchBox).toHaveAttribute('tabindex', '0');

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'createdAt' },
    });
    fireEvent.click(screen.getByLabelText('Search in updates'));
    fireEvent.click(screen.getByLabelText('Search in tags'));

    expect(screen.getByRole('combobox')).toHaveValue('createdAt');
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveValue('updatedAt');
      expect(screen.getByLabelText('Search in updates')).toBeChecked();
      expect(screen.getByLabelText('Search in tags')).toBeChecked();
      expect(screen.getByLabelText('Search in answers')).toBeChecked();
    });

    expect(removeItemSpy).toHaveBeenCalledWith('prayers:searchInUpdates');
    expect(removeItemSpy).toHaveBeenCalledWith('prayers:searchInTags');
    expect(removeItemSpy).toHaveBeenCalledWith('prayers:searchInAnswers');

    const searchWrapper = screen.getByRole('search').parentElement as HTMLElement;
    fireEvent.blur(searchWrapper, { relatedTarget: document.body });

    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toHaveAttribute('tabindex', '-1');
    });

    removeItemSpy.mockRestore();
  });

  it('falls back to enabled search scopes when localStorage access throws', () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    render(<PrayerPage />);

    expect(screen.getByLabelText('Search in updates')).toBeChecked();
    expect(screen.getByLabelText('Search in tags')).toBeChecked();
    expect(screen.getByLabelText('Search in answers')).toBeChecked();

    getItemSpy.mockRestore();
  });

  it('renders loading skeletons while prayers are fetching', () => {
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [],
      loading: true,
      createPrayer,
      updatePrayer,
      deletePrayer,
      addUpdate,
      setStatus,
    });

    const { container } = render(<PrayerPage />);

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });
});
