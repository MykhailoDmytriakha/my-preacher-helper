import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import CreateGroupModal from '@/components/groups/CreateGroupModal';

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(() => ({ user: { uid: 'user-1' } })),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

describe('CreateGroupModal', () => {
  it('submits trimmed payload with bootstrap templates and first meeting date', async () => {
    const onClose = jest.fn();
    const onCreate = jest.fn().mockResolvedValue(undefined);

    render(<CreateGroupModal onClose={onClose} onCreate={onCreate} />);

    fireEvent.change(screen.getByPlaceholderText('Family group - Week 1'), {
      target: { value: '  Group A  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Optional context for this group meeting'), {
      target: { value: '  Notes  ' },
    });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, {
      target: { value: '2026-02-14' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const payload = onCreate.mock.calls[0][0];

    expect(payload.userId).toBe('user-1');
    expect(payload.title).toBe('Group A');
    expect(payload.description).toBe('Notes');
    expect(payload.templates).toHaveLength(2);
    expect(payload.flow).toHaveLength(2);
    expect(payload.meetingDates).toHaveLength(1);
    expect(payload.meetingDates[0].date).toBe('2026-02-14');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows create error and keeps modal open', async () => {
    const onClose = jest.fn();
    const onCreate = jest.fn().mockRejectedValue(new Error('boom'));

    render(<CreateGroupModal onClose={onClose} onCreate={onCreate} />);

    fireEvent.change(screen.getByPlaceholderText('Family group - Week 1'), {
      target: { value: 'Group A' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() =>
      expect(screen.getByText('Failed to create group. Please try again.')).toBeInTheDocument()
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
