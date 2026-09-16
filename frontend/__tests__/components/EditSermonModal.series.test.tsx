import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import React from 'react';

import EditSermonModal from '@/components/EditSermonModal';
import { useSeries } from '@/hooks/useSeries';
import { useSeriesMembership } from '@/hooks/useSeriesMembership';
import { updateSermon } from '@/services/sermon.service';
import '@testing-library/jest-dom';

import type { Series, Sermon } from '@/models/models';

jest.mock('@/services/sermon.service', () => ({
  updateSermon: jest.fn(),
  getSermons: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/services/preachDates.service', () => ({
  addPreachDate: jest.fn(),
  updatePreachDate: jest.fn(),
  deletePreachDate: jest.fn(),
}));

jest.mock('@/hooks/useSeries', () => ({ useSeries: jest.fn() }));
jest.mock('@/hooks/useSeriesMembership', () => ({ useSeriesMembership: jest.fn() }));

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

const mockUseSeries = jest.mocked(useSeries);
const mockUseSeriesMembership = jest.mocked(useSeriesMembership);
const mockUpdateSermon = jest.mocked(updateSermon);

const seriesList = [
  { id: 's1', title: 'Первая серия', items: [{ id: 'i1', type: 'sermon', refId: 'sermon-1' }] },
  { id: 's2', title: 'Вторая серия', items: [] },
] as unknown as Series[];

const sermon: Sermon = {
  id: 'sermon-1',
  title: 'О терпении',
  verse: 'Иак 1:4',
  date: '2026-09-01T00:00:00Z',
  thoughts: [],
  userId: 'u1',
};

const addToSeries = jest.fn();
const removeFromAllSeries = jest.fn();

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
    mockUseSeries.mockReturnValue({ series: seriesList, loading: false } as never);
    mockUseSeriesMembership.mockReturnValue({
      addToSeries,
      removeFromAllSeries,
      addRefsToSeries: jest.fn(),
      reorderSeries: jest.fn(),
    } as never);
    mockUpdateSermon.mockResolvedValue({ ...sermon } as never);
  });

  it('opens on the series the sermon is actually in, derived from the playlist', () => {
    renderModal();

    expect(seriesField().value).toBe('s1');
  });

  it('moves the sermon through the one membership writer when another series is chosen', async () => {
    renderModal();

    fireEvent.change(seriesField(), { target: { value: 's2' } });
    save();

    await waitFor(() => expect(addToSeries).toHaveBeenCalledWith('s2', { type: 'sermon', refId: 'sermon-1' }));
    expect(removeFromAllSeries).not.toHaveBeenCalled();
  });

  it('takes the sermon out of every series when "no series" is chosen', async () => {
    renderModal();

    fireEvent.change(seriesField(), { target: { value: '' } });
    save();

    await waitFor(() => expect(removeFromAllSeries).toHaveBeenCalledWith({ type: 'sermon', refId: 'sermon-1' }));
    expect(addToSeries).not.toHaveBeenCalled();
  });

  it('leaves membership alone when only the title changed', async () => {
    renderModal();

    fireEvent.change(screen.getByLabelText(/addSermon.titleLabel/), { target: { value: 'О терпении и вере' } });
    save();

    await waitFor(() => expect(mockUpdateSermon).toHaveBeenCalled());
    expect(addToSeries).not.toHaveBeenCalled();
    expect(removeFromAllSeries).not.toHaveBeenCalled();
  });

  it('lets a series change alone be saved, with nothing else edited', () => {
    renderModal();

    fireEvent.change(seriesField(), { target: { value: 's2' } });

    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  });

  it('says the series are still loading rather than showing an empty picker', () => {
    mockUseSeries.mockReturnValue({ series: [], loading: true } as never);

    renderModal();

    expect(screen.getByText('workspaces.series.loadingSeries')).toBeInTheDocument();
  });
});
