import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { Toaster, toast } from 'sonner';

import AddSermonModal from '@/components/AddSermonModal';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';

const makeFirestoreError = (code: string, message = code): Error & { code: string } => {
  const { FirestoreError } = jest.requireActual<typeof import('firebase/firestore')>('firebase/firestore');
  const Ctor = FirestoreError as unknown as new (code: string, message: string) => Error & { code: string };
  return new Ctor(code, message);
};

const mockCreateSermon = jest.fn();

jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), createPortal: (node: React.ReactNode) => node }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('@/hooks/useSeries', () => ({ useSeries: () => ({ series: [] }) }));
jest.mock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: { uid: 'user-1' } } }));
jest.mock('@/services/sermon.service', () => ({ createSermon: jest.fn() }));
jest.mock('@/services/preachDates.service', () => ({ addPreachDate: jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => ({
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
      'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
    }[key] ?? options?.defaultValue ?? key),
  }),
}));

describe('AddSermonModal write refusal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSermon.mockReset();
  });

  it('keeps the refused sermon draft in the open modal instead of closing as if created', async () => {
    // Pins the loss where a denied sermon creation closed the only copy of the person's title and verse.
    mockCreateSermon.mockRejectedValue(makeFirestoreError('permission-denied', 'Permission denied'));
    const onClose = jest.fn();
    render(
      <>
        <Toaster />
        <AddSermonModal
          isOpen
          showTriggerButton={false}
          onClose={onClose}
          onCreateRequest={(input) => persistedWrite(mockCreateSermon(input))}
        />
      </>
    );

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Exact refused sermon title' } });
    fireEvent.change(screen.getByLabelText('Verse'), { target: { value: 'Exact refused sermon verse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockCreateSermon).toHaveBeenCalledTimes(1));
    // The MESSAGE belongs to the dashboard's recovery badge (or, for a local refusal, to
    // `refusedWrite` itself) — one refusal, one reporter. What the modal owes the person
    // is below: it stays open with the typed sermon intact.
    expect(screen.getByLabelText('Title')).toHaveValue('Exact refused sermon title');
    expect(screen.getByLabelText('Verse')).toHaveValue('Exact refused sermon verse');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays silent when the sermon create is deferred to a queue', async () => {
    const onClose = jest.fn();
    const errorSpy = jest.spyOn(toast, 'error');
    const successSpy = jest.spyOn(toast, 'success');
    render(
      <AddSermonModal
        isOpen
        showTriggerButton={false}
        onClose={onClose}
        onCreateRequest={(input) => {
          mockCreateSermon(input);
          return queuedWrite('sermon:create', Promise.resolve());
        }}
      />
    );

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Queued sermon' } });
    fireEvent.change(screen.getByLabelText('Verse'), { target: { value: 'John 3:16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    successSpy.mockRestore();
  });
});
