import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import AddSermonModal from '@/components/AddSermonModal';
import { createSermon } from '@/services/sermon.service';

import { TestProviders } from '../../test-utils/test-providers';
import '@testing-library/jest-dom';

const mockUseAuth = jest.fn<{ user: { uid: string } | null }, []>(() => ({ user: { uid: 'test-user-id' } }));
const mockUseSeries = jest.fn((_userId: string | null) => ({ series: [] }));

jest.mock('@/services/sermon.service', () => ({
  createSermon: jest.fn().mockResolvedValue({
    id: 'mocked-sermon-id',
    title: 'Mocked Sermon',
    verse: 'Mocked Verse',
    date: '2026-04-14T12:00:00Z',
    thoughts: [],
    userId: 'test-user-id',
  }),
}));

jest.mock('@/services/preachDates.service', () => ({
  addPreachDate: jest.fn(),
}));

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: {
    currentUser: {
      uid: 'test-user-id',
    },
  },
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: (userId: string | null) => mockUseSeries(userId),
}));

jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }),
}));

jest.mock('react-day-picker/dist/style.css', () => ({}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'addSermon.newSermon': 'New Sermon',
        'addSermon.titleLabel': 'Title',
        'addSermon.titlePlaceholder': 'Enter sermon title',
        'addSermon.titleExample': 'Example title',
        'addSermon.verseLabel': 'Verse',
        'addSermon.versePlaceholder': 'Enter scripture reference',
        'addSermon.verseExample': 'Example verse',
        'addSermon.seriesLabel': 'Series',
        'addSermon.noSeriesOption': 'No series',
        'addSermon.save': 'Save',
        'addSermon.cancel': 'Cancel',
        'calendar.unspecifiedChurch': 'Church not specified',
      };

      return translations[key] || options?.defaultValue || key;
    },
  }),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;

  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('AddSermonModal async submit flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { uid: 'test-user-id' } });
    mockUseSeries.mockReturnValue({ series: [] });
  });

  it('keeps form data visible while async post-create work is still pending, then closes after completion', async () => {
    const postCreate = createDeferred<void>();
    const onNewSermonCreated = jest.fn(() => postCreate.promise);

    function ControlledModal() {
      const [open, setOpen] = React.useState(true);

      return (
        <AddSermonModal
          isOpen={open}
          showTriggerButton={false}
          onClose={() => setOpen(false)}
          onNewSermonCreated={onNewSermonCreated}
        />
      );
    }

    render(
      <TestProviders>
        <ControlledModal />
      </TestProviders>
    );

    fireEvent.change(screen.getByPlaceholderText('Enter sermon title'), {
      target: { value: 'Async Sermon Title' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter scripture reference'), {
      target: { value: 'John 3:16' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createSermon).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Async Sermon Title',
          verse: 'John 3:16',
        })
      );
      expect(onNewSermonCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mocked-sermon-id' })
      );
    });

    expect(screen.getByDisplayValue('Async Sermon Title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('John 3:16')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    postCreate.resolve();

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'New Sermon' })).not.toBeInTheDocument();
    });
  });

  it('keeps delegated create form open when the delegated request rejects', async () => {
    const onCreateRequest = jest.fn().mockRejectedValue(new Error('optimistic-fail'));
    const onClose = jest.fn();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    render(
      <TestProviders>
        <AddSermonModal
          isOpen
          showTriggerButton={false}
          onClose={onClose}
          onCreateRequest={onCreateRequest}
        />
      </TestProviders>
    );

    fireEvent.change(screen.getByPlaceholderText('Enter sermon title'), {
      target: { value: 'Delegated Sermon' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter scripture reference'), {
      target: { value: 'Acts 1:8' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onCreateRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Delegated Sermon',
          verse: 'Acts 1:8',
        })
      );
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Delegated Sermon')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acts 1:8')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error creating sermon (optimistic request):',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
