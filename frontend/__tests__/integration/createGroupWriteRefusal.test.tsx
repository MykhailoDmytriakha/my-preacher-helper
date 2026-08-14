import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CreateGroupModal from '@/components/groups/CreateGroupModal';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';

const makeFirestoreError = (code: string, message = code): Error & { code: string } => {
  const { FirestoreError } = jest.requireActual<typeof import('firebase/firestore')>('firebase/firestore');
  const Ctor = FirestoreError as unknown as new (code: string, message: string) => Error & { code: string };
  return new Ctor(code, message);
};

const mockCreateGroup = jest.fn();

jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), createPortal: (node: React.ReactNode) => node }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }) }));
jest.mock('react-day-picker/dist/style.css', () => ({}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => ({
      'navigation.groups': 'Groups',
      'workspaces.groups.actions.newGroup': 'New group',
      'workspaces.groups.actions.create': 'Create group',
      'workspaces.groups.form.title': 'Title',
      'workspaces.groups.form.titlePlaceholder': 'Family group - Week 1',
      'workspaces.groups.form.description': 'Description',
      'workspaces.groups.form.descriptionPlaceholder': 'Optional context for this group meeting',
      'workspaces.groups.meetings.title': 'Meeting dates',
      'workspaces.groups.errors.createFailed': 'Save refused. Nothing was saved; your text is still here.',
      'common.cancel': 'Cancel',
      'common.saving': 'Saving',
      'common.optional': 'optional',
      'workspaces.groups.defaults.prayer': 'Prayer',
      'workspaces.groups.defaults.mainTopic': 'Main topic',
      'workspaces.groups.defaults.scripture': 'Scripture references',
    }[key] ?? options?.defaultValue ?? key),
  }),
}));

describe('CreateGroupModal write refusal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateGroup.mockReset();
  });

  it('keeps the refused group draft in the open modal instead of closing as if created', async () => {
    // Pins the loss where a denied group creation removed the person's title and description from the only editor.
    mockCreateGroup.mockRejectedValue(makeFirestoreError('permission-denied', 'Permission denied'));
    const onClose = jest.fn();
    render(<CreateGroupModal onClose={onClose} onCreate={(input) => persistedWrite(mockCreateGroup(input))} />);

    fireEvent.change(screen.getByPlaceholderText('Family group - Week 1'), { target: { value: 'Exact refused group title' } });
    fireEvent.change(screen.getByPlaceholderText('Optional context for this group meeting'), { target: { value: 'Exact refused group description' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => expect(mockCreateGroup).toHaveBeenCalledTimes(1));
    // The message belongs to useGroups' recovery descriptor — one refusal, one reporter.
    // What the modal owes the person is below: it stays open with the exact draft.
    expect(screen.getByPlaceholderText('Family group - Week 1')).toHaveValue('Exact refused group title');
    expect(screen.getByPlaceholderText('Optional context for this group meeting')).toHaveValue('Exact refused group description');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes silently when group creation is deferred to a queue', async () => {
    const onClose = jest.fn();
    render(<CreateGroupModal onClose={onClose} onCreate={() => queuedWrite('group:create', Promise.resolve())} />);

    fireEvent.change(screen.getByPlaceholderText('Family group - Week 1'), { target: { value: 'Queued group' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Save refused. Nothing was saved; your text is still here.')).not.toBeInTheDocument();
  });
});
