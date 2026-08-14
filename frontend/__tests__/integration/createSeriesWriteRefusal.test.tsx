import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CreateSeriesModal from '@/components/series/CreateSeriesModal';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';

const makeFirestoreError = (code: string, message = code): Error & { code: string } => {
  const { FirestoreError } = jest.requireActual<typeof import('firebase/firestore')>('firebase/firestore');
  const Ctor = FirestoreError as unknown as new (code: string, message: string) => Error & { code: string };
  return new Ctor(code, message);
};

const mockCreateSeries = jest.fn();

jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), createPortal: (node: React.ReactNode) => node }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('@/components/ColorPickerModal', () => () => null);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => ({
      'workspaces.series.newSeries': 'New Series',
      'workspaces.series.description': 'Organize your sermon series',
      'workspaces.series.form.title': 'Series title',
      'workspaces.series.form.titlePlaceholder': 'Enter series title',
      'workspaces.series.form.bookOrTopic': 'Book or topic',
      'workspaces.series.form.bookOrTopicPlaceholder': 'e.g., Romans',
      'workspaces.series.form.description': 'Description',
      'workspaces.series.form.descriptionPlaceholder': 'Brief description',
      'workspaces.series.form.status': 'Status',
      'workspaces.series.form.statuses.draft': 'Draft',
      'workspaces.series.form.statuses.active': 'Active',
      'workspaces.series.form.statuses.completed': 'Completed',
      'workspaces.series.form.color': 'Color',
      'workspaces.series.actions.cancel': 'Cancel',
      'workspaces.series.actions.createSeries': 'Create series',
      'common.saving': 'Saving',
      'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
    }[key] ?? options?.defaultValue ?? key),
  }),
}));

describe('CreateSeriesModal write refusal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSeries.mockReset();
  });

  it('keeps a refused series title and topic open instead of pretending the series exists', async () => {
    // Pins the loss where a denied series create discarded the person's title and topic behind a closed modal.
    mockCreateSeries.mockRejectedValue(makeFirestoreError('invalid-argument', 'Invalid argument'));
    const onClose = jest.fn();
    render(<CreateSeriesModal onClose={onClose} onCreate={(input) => persistedWrite(mockCreateSeries(input))} />);

    fireEvent.change(screen.getByPlaceholderText('Enter series title'), { target: { value: 'Exact refused series title' } });
    fireEvent.change(screen.getByPlaceholderText('e.g., Romans'), { target: { value: 'Exact refused topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create series' }));

    await waitFor(() => expect(mockCreateSeries).toHaveBeenCalledTimes(1));
    // The MESSAGE now belongs to this entity's recovery descriptor (see
    // docs/recoverable-writes.md): it carries the text and follows the person off this
    // screen, and a second message from the editor showed one refusal as two failures.
    // What the editor still owes the person is asserted below: it stays open, holding
    // exactly what they entered, and claims nothing was saved.
    expect(screen.getByPlaceholderText('Enter series title')).toHaveValue('Exact refused series title');
    expect(screen.getByPlaceholderText('e.g., Romans')).toHaveValue('Exact refused topic');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes silently when the series create is deferred to a queue', async () => {
    const onClose = jest.fn();
    render(<CreateSeriesModal onClose={onClose} onCreate={() => queuedWrite('series:create', Promise.resolve())} />);

    fireEvent.change(screen.getByPlaceholderText('Enter series title'), { target: { value: 'Queued series' } });
    fireEvent.change(screen.getByPlaceholderText('e.g., Romans'), { target: { value: 'Romans' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create series' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Save refused. Nothing was saved; your text is still here.')).not.toBeInTheDocument();
  });
});
