import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import CreateGroupModal from '@/components/groups/CreateGroupModal';
import { Group } from '@/models/models';
import { persistedWrite } from '@/utils/recoverableWrite';

// A refusal must carry `code`: production classifies by it alone
// (services/conflictSafeUpdate.client.ts), so a bare Error would take the
// transient branch and prove nothing about the path that runs live.
const refusal = () =>
  Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
    name: 'FirebaseError',
  });

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(() => ({ user: { uid: 'user-1' } })),
}));

jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }),
}));

jest.mock('react-day-picker/dist/style.css', () => ({}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

describe('CreateGroupModal', () => {
  it('submits trimmed payload with bootstrap templates and first meeting date', async () => {
    const onClose = jest.fn();
    // The write contract: the prop returns a WriteSubmission, not a bare promise.
    const onCreate = jest.fn((_payload: Omit<Group, 'id'>) => persistedWrite(Promise.resolve()));

    render(<CreateGroupModal onClose={onClose} onCreate={onCreate} />);

    fireEvent.change(screen.getByPlaceholderText('Family group - Week 1'), {
      target: { value: '  Group A  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Optional context for this group meeting'), {
      target: { value: '  Notes  ' },
    });
    const dateInput = screen.getByPlaceholderText('yyyy-mm-dd') as HTMLInputElement;
    fireEvent.change(dateInput, {
      target: { value: '2026-02-14' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const payload = onCreate.mock.calls[0][0];

    expect(payload.userId).toBe('user-1');
    expect(payload.title).toBe('Group A');
    expect(payload.description).toBe('Notes');
    expect(payload.templates).toHaveLength(3);
    expect(payload.flow).toHaveLength(3);
    expect(payload.meetingDates).toHaveLength(1);
    expect(payload.meetingDates?.[0]?.date).toBe('2026-02-14');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a REFUSED create keeps the modal open, so the typed group is not destroyed', async () => {
    const onClose = jest.fn();
    // Refused BEFORE anything takes ownership: acceptance rejects, and the contract
    // requires the form to stay open with every field intact.
    const submissions: Array<ReturnType<typeof persistedWrite>> = [];
    const onCreate = jest.fn(() => {
      const submission = persistedWrite(Promise.reject(refusal()));
      submissions.push(submission);
      return submission;
    });

    render(<CreateGroupModal onClose={onClose} onCreate={onCreate} />);

    fireEvent.change(screen.getByPlaceholderText('Family group - Week 1'), {
      target: { value: 'Group A' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    /**
     * WAIT FOR THE REFUSAL TO SETTLE FIRST. A negative `waitFor` succeeds immediately,
     * so the previous version passed before the rejection was even handled — it would
     * have stayed green if the modal closed one microtask later, destroying the typed
     * group. Waiting on the submission makes the assertion mean something.
     */
    // The write must have HAPPENED — `submissions[0]?.…` would quietly resolve to
    // undefined if `onCreate` was never called, leaving this test green for the wrong
    // reason.
    expect(onCreate).toHaveBeenCalledTimes(1);
    await act(async () => {
      await submissions[0].acceptance.catch(() => undefined);
    });

    // The MESSAGE belongs to useGroups' recovery descriptor — one refusal, one reporter.
    // What this modal owes the person: it does not close, and the text is still there.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Family group - Week 1')).toHaveValue('Group A');
  });
});
