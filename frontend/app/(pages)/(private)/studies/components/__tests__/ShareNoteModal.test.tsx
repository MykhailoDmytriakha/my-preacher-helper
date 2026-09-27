import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useClipboard } from '@/hooks/useClipboard';
import { StudyNote, StudyNoteShareLink } from '@/models/models';
import { persistedWrite } from '@/utils/recoverableWrite';

import ShareNoteModal from '../ShareNoteModal';

jest.mock('@/hooks/useClipboard', () => ({
  useClipboard: jest.fn(),
}));

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

const mockUseClipboard = useClipboard as jest.MockedFunction<typeof useClipboard>;

const createTestNote = (overrides: Partial<StudyNote> = {}): StudyNote => {
  const timestamp = new Date().toISOString();
  return {
    id: 'note-1',
    userId: 'user-1',
    content: 'Test content',
    title: 'Test note',
    scriptureRefs: [],
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    isDraft: false,
    ...overrides,
  };
};

const createShareLink = (overrides: Partial<StudyNoteShareLink> = {}): StudyNoteShareLink => ({
  id: 'link-1',
  noteId: 'note-1',
  ownerId: 'user-1',
  token: 'token-123',
  createdAt: new Date().toISOString(),
  viewCount: 2,
  ...overrides,
});

const COPY = 'studiesWorkspace.shareLinks.copyLink';
const DELETE = 'studiesWorkspace.shareLinks.deleteLink';
const KEEP = 'studiesWorkspace.shareLinks.keepLink';
const CREATE = 'studiesWorkspace.shareLinks.createButton';

describe('ShareNoteModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseClipboard.mockReturnValue({
      isCopied: false,
      isLoading: false,
      error: null,
      copyToClipboard: jest.fn().mockResolvedValue(true),
      reset: jest.fn(),
    });
  });

  it('invites to create a link when none exists, and never shows copy or delete', () => {
    render(
      <ShareNoteModal isOpen note={createTestNote()} shareLink={undefined} onClose={jest.fn()} onCreate={jest.fn()} onDelete={jest.fn()} />
    );

    expect(screen.getByText('studiesWorkspace.shareLinks.accessOff')).toBeInTheDocument();
    expect(screen.getByText('studiesWorkspace.shareLinks.inviteText')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CREATE })).toBeEnabled();
    expect(screen.queryByRole('button', { name: COPY })).toBeNull();
    expect(screen.queryByRole('button', { name: DELETE })).toBeNull();
  });

  it('holds the create button while the links are still loading', () => {
    render(
      <ShareNoteModal isOpen loading note={createTestNote()} shareLink={undefined} onClose={jest.fn()} onCreate={jest.fn()} onDelete={jest.fn()} />
    );

    expect(screen.getByRole('button', { name: CREATE })).toBeDisabled();
    expect(screen.getByText('studiesWorkspace.shareLinks.loadingLink')).toBeInTheDocument();
  });

  it('creates a share link when the create button is clicked', async () => {
    const user = userEvent.setup();
    const onCreate = jest.fn(() => persistedWrite(Promise.resolve()));

    render(
      <ShareNoteModal isOpen note={createTestNote()} shareLink={undefined} onClose={jest.fn()} onCreate={onCreate} onDelete={jest.fn()} />
    );

    await user.click(screen.getByRole('button', { name: CREATE }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('note-1'));
  });

  it('shows the link, copy, open and the quiet delete line when a link exists', () => {
    const shareLink = createShareLink();
    render(
      <ShareNoteModal isOpen note={createTestNote()} shareLink={shareLink} onClose={jest.fn()} onCreate={jest.fn()} onDelete={jest.fn()} />
    );

    expect(screen.getByText('studiesWorkspace.shareLinks.accessOn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'studiesWorkspace.shareLinks.openLink' })).toHaveAttribute(
      'href',
      expect.stringContaining(shareLink.token),
    );
    expect(screen.getByRole('button', { name: DELETE })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: CREATE })).toBeNull();
  });

  it('copies the full share url', async () => {
    const user = userEvent.setup();
    const copyToClipboard = jest.fn().mockResolvedValue(true);
    const shareLink = createShareLink();
    mockUseClipboard.mockReturnValue({ isCopied: false, isLoading: false, error: null, copyToClipboard, reset: jest.fn() });

    render(
      <ShareNoteModal isOpen note={createTestNote()} shareLink={shareLink} onClose={jest.fn()} onCreate={jest.fn()} onDelete={jest.fn()} />
    );

    await user.click(screen.getByRole('button', { name: COPY }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining(shareLink.token)));
  });

  it('asks in place before deleting, and only the confirmation deletes', async () => {
    const user = userEvent.setup();
    const onDelete = jest.fn(() => persistedWrite(Promise.resolve()));

    render(
      <ShareNoteModal isOpen note={createTestNote()} shareLink={createShareLink()} onClose={jest.fn()} onCreate={jest.fn()} onDelete={onDelete} />
    );

    await user.click(screen.getByRole('button', { name: DELETE }));

    const question = screen.getByRole('alertdialog');
    expect(question).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    // Focus lands on the safe answer, so Enter never deletes by accident.
    expect(screen.getByRole('button', { name: KEEP })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: DELETE }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('link-1'));
  });

  it('withdraws the question on "keep" and on Escape without closing the window', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    render(
      <ShareNoteModal isOpen note={createTestNote()} shareLink={createShareLink()} onClose={onClose} onCreate={jest.fn()} onDelete={jest.fn()} />
    );

    await user.click(screen.getByRole('button', { name: DELETE }));
    await user.click(screen.getByRole('button', { name: KEEP }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: DELETE }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: DELETE })).toBeInTheDocument();
  });

  it('withdraws the question when the link changes underneath it', async () => {
    const user = userEvent.setup();
    const props = { isOpen: true, note: createTestNote(), onClose: jest.fn(), onCreate: jest.fn(), onDelete: jest.fn() };
    const { rerender } = render(<ShareNoteModal {...props} shareLink={createShareLink()} />);

    await user.click(screen.getByRole('button', { name: DELETE }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    rerender(<ShareNoteModal {...props} shareLink={createShareLink({ id: 'link-2', token: 'new-token' })} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

it.each(['close', 'link'] as const)('invalidates a pending copy when the share scope changes: %s', async change => {
  mockUseClipboard.mockImplementation(jest.requireActual('@/hooks/useClipboard').useClipboard);
  let finish!: () => void;
  const writeText = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  const props = { isOpen: true, note: createTestNote(), shareLink: createShareLink(), onClose: jest.fn(), onCreate: jest.fn(), onDelete: jest.fn() };
  const { rerender } = render(<ShareNoteModal {...props} />);
  fireEvent.click(screen.getByRole('button', { name: COPY }));
  if (change === 'close') rerender(<ShareNoteModal {...props} isOpen={false} />);
  else rerender(<ShareNoteModal {...props} shareLink={createShareLink({ token: 'new-token' })} />);
  await act(async () => { finish(); });
  if (change === 'close') rerender(<ShareNoteModal {...props} />);
  expect(screen.queryByRole('button', { name: 'common.copied' })).toBeNull();
  expect(screen.getByRole('button', { name: COPY })).toBeInTheDocument();
});
