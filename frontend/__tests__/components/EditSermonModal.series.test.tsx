import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import React from 'react';

import EditSermonModal from '@/components/EditSermonModal';
import { updateSermon } from '@/services/sermon.service';
import '@testing-library/jest-dom';

import type { Sermon } from '@/models/models';

jest.mock('@/services/sermon.service', () => ({
  updateSermon: jest.fn(),
  getSermons: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/services/preachDates.service', () => ({
  addPreachDate: jest.fn(),
  updatePreachDate: jest.fn(),
  deletePreachDate: jest.fn(),
}));

/*
 * The series field is the engine's (useEngineSeriesField): the playlist rows say which series the
 * sermon is in, and a change is one membership action saved with the form. The stand-in keeps its
 * own selection so the dialog redraws the way the real field does.
 */
const mockChange = jest.fn();
const mockSave = jest.fn(async () => undefined);
const mockField = { seriesId: 's1', loading: false };
jest.mock('@/components/series/useEngineSeriesField', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    useEngineSeriesField: () => {
      const [seriesId, setSeriesId] = ReactActual.useState(mockField.seriesId);
      return {
        action: {}, seriesId, changed: seriesId !== mockField.seriesId,
        options: [{ id: 's1', label: 'Первая серия' }, { id: 's2', label: 'Вторая серия' }],
        loading: mockField.loading, disabled: false, unsettled: false,
        change: async (id: string) => { mockChange(id); setSeriesId(id); },
        save: mockSave, cancel: async () => undefined, retry: jest.fn(),
      };
    },
  };
});
jest.mock('@/data-engine/DataMembershipStatus', () => ({ DataMembershipStatus: () => null }));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'u1' } }),
}));

jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: () => ({ isOnline: true, isMagicAvailable: true, checkConnection: jest.fn() }),
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }),
}));

jest.mock('react-day-picker/dist/style.css', () => ({}));

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (element: React.ReactNode) => element,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; field?: string }) =>
      options?.field ? `${key}:${options.field}` : options?.defaultValue ?? key,
  }),
}));

const mockUpdateSermon = jest.mocked(updateSermon);

const sermon: Sermon = {
  id: 'sermon-1',
  title: 'О терпении',
  verse: 'Иак 1:4',
  date: '2026-09-01T00:00:00Z',
  thoughts: [],
  userId: 'u1',
};

const renderModal = (props: Partial<React.ComponentProps<typeof EditSermonModal>> = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <EditSermonModal sermon={sermon} onClose={jest.fn()} onUpdate={jest.fn()} {...props} />
    </QueryClientProvider>
  );
};

const seriesField = () => screen.getByLabelText('addSermon.seriesLabel') as HTMLSelectElement;
const save = () => fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));

describe('the edit door can move a sermon between series', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockField.seriesId = 's1';
    mockField.loading = false;
    mockUpdateSermon.mockResolvedValue({ ...sermon } as never);
  });

  it('opens on the series the engine\'s playlist rows put the sermon in', () => {
    renderModal();

    expect(seriesField().value).toBe('s1');
  });

  it('moves the sermon through the one membership action when another series is chosen', async () => {
    renderModal();

    fireEvent.change(seriesField(), { target: { value: 's2' } });
    expect(mockChange).toHaveBeenCalledWith('s2');
    save();

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  });

  it('takes the sermon out of every series when "no series" is chosen', async () => {
    renderModal();

    fireEvent.change(seriesField(), { target: { value: '' } });
    expect(mockChange).toHaveBeenCalledWith('');
    save();

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  });

  it('leaves membership alone when only the title changed', async () => {
    renderModal();

    fireEvent.change(screen.getByLabelText(/addSermon.titleLabel/), { target: { value: 'О терпении и вере' } });
    save();

    await waitFor(() => expect(mockUpdateSermon).toHaveBeenCalled());
    expect(mockChange).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('lets a series change alone be saved, with nothing else edited', () => {
    renderModal();

    fireEvent.change(seriesField(), { target: { value: 's2' } });

    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  });

  it('says the series are still loading rather than showing an empty picker', () => {
    mockField.loading = true;

    renderModal();

    expect(screen.getByText('workspaces.series.loadingSeries')).toBeInTheDocument();
  });
});
