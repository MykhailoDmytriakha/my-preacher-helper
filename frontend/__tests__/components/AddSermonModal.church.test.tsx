import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import AddSermonModal from '@/components/AddSermonModal';
import { persistedWrite } from '@/utils/recoverableWrite';
import { addPreachDate } from '@/services/preachDates.service';
import { createSermon, getSermons } from '@/services/sermon.service';

import '@testing-library/jest-dom';

jest.mock('@/services/sermon.service', () => ({
  createSermon: jest.fn(),
  getSermons: jest.fn(),
}));

jest.mock('@/services/preachDates.service', () => ({
  addPreachDate: jest.fn(),
}));

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: { currentUser: { uid: 'test-user-id' } },
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'test-user-id' } }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'test-user-id' } }),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: () => ({ series: [] }),
}));

jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }),
}));

jest.mock('react-day-picker/dist/style.css', () => ({}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'addSermon.newSermon': 'New Sermon',
        'addSermon.titleLabel': 'Title',
        'addSermon.titlePlaceholder': 'Enter sermon title',
        'addSermon.verseLabel': 'Scripture Reference',
        'addSermon.versePlaceholder': 'Enter scripture reference',
        'addSermon.seriesLabel': 'Series',
        'addSermon.noSeriesOption': 'No series',
        'addSermon.plannedDateLabel': 'Planned preaching date (optional)',
        'addSermon.groupSermon': 'Sermon',
        'addSermon.groupLater': 'Can be filled in later',
        'addSermon.groupLaterHint': 'You can change the church and the date later in Calendar',
        'addSermon.save': 'Save',
        'addSermon.cancel': 'Cancel',
        'calendar.church': 'Church',
        'calendar.unspecifiedChurch': 'Church not specified',
        'calendar.churchAutocomplete.placeholder': 'Start typing a name',
      };
      return translations[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

const renderWithClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

/**
 * Typing into the combobox opens its list, and Headless UI makes the rest of the form
 * inert while it is open — so Save is unreachable BY ROLE until the list closes. In a
 * browser the pointer press closes it before the click lands; here Escape stands in for
 * that, which is also exactly what a keyboard user does.
 */
const chooseChurch = (name: string) => {
  const field = screen.getByLabelText('Church');
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: 'Escape' });
};

const fillRequiredFields = () => {
  fireEvent.change(screen.getByPlaceholderText('Enter sermon title'), {
    target: { value: 'Grace that carries' },
  });
  fireEvent.change(screen.getByPlaceholderText('Enter scripture reference'), {
    target: { value: 'Eph 2:8' },
  });
};

describe('AddSermonModal — the congregation a sermon is prepared for', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSermons as jest.Mock).mockResolvedValue([]);
    (createSermon as jest.Mock).mockResolvedValue({
      id: 'new-sermon',
      title: 'Grace that carries',
      verse: 'Eph 2:8',
      date: '2026-09-12T00:00:00.000Z',
      thoughts: [],
      userId: 'test-user-id',
    });
    (addPreachDate as jest.Mock).mockResolvedValue({
      id: 'pd-1',
      date: '2026-10-05',
      status: 'planned',
      church: { id: '', name: 'Bethel', city: '' },
      createdAt: '2026-09-12T00:00:00.000Z',
    });
  });

  test('a church named WITHOUT a date is still stored, on the sermon itself', async () => {
    const onCreateRequest = jest.fn().mockReturnValue(persistedWrite(Promise.resolve()));

    renderWithClient(
      <AddSermonModal isOpen showTriggerButton={false} allowPlannedDate onCreateRequest={onCreateRequest} />
    );

    fillRequiredFields();
    chooseChurch('Bethel');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onCreateRequest).toHaveBeenCalled());
    const input = onCreateRequest.mock.calls[0][0];
    expect(input.church).toEqual({ id: '', name: 'Bethel', city: '' });
    // This is the whole point of the field: no date was given, and the church survives.
    expect(input.plannedDate).toBeUndefined();
  });

  test('a church named WITH a date reaches the preach date too, instead of the stand-in', async () => {
    renderWithClient(<AddSermonModal isOpen showTriggerButton={false} allowPlannedDate />);

    fillRequiredFields();
    chooseChurch('Bethel');
    fireEvent.change(screen.getByLabelText('Planned preaching date (optional)'), {
      target: { value: '2026-10-05' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addPreachDate).toHaveBeenCalled());
    expect((addPreachDate as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({ church: { id: '', name: 'Bethel', city: '' } })
    );
    // The sermon carries it as well: the two facts are stored side by side, never derived.
    expect((createSermon as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({ church: { id: '', name: 'Bethel', city: '' } })
    );
  });

  test('a freshly typed church survives closing the suggestion list', async () => {
    // Found live: the previous combobox rewrote the input to the SELECTED option every
    // time the list closed. A brand-new church matches no option, so the name vanished
    // from the field while the form still held it — the screen lied about what it
    // would save. The field owns its text now, and this says so.
    renderWithClient(<AddSermonModal isOpen showTriggerButton={false} allowPlannedDate />);

    const field = screen.getByLabelText('Church');
    fireEvent.change(field, { target: { value: 'Bethel Sarny' } });
    fireEvent.keyDown(field, { key: 'Escape' });

    expect(field).toHaveValue('Bethel Sarny');
  });

  test('leaving the church empty still falls back to the stand-in for the date', async () => {
    renderWithClient(<AddSermonModal isOpen showTriggerButton={false} allowPlannedDate />);

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Planned preaching date (optional)'), {
      target: { value: '2026-10-05' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addPreachDate).toHaveBeenCalled());
    expect((addPreachDate as jest.Mock).mock.calls[0][1].church).toEqual(
      expect.objectContaining({ id: 'church-unspecified' })
    );
    expect((createSermon as jest.Mock).mock.calls[0][0].church).toBeUndefined();
  });
});
