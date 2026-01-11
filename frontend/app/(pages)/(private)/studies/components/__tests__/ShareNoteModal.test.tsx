import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useClipboard } from '@/hooks/useClipboard';
import { StudyNote, StudyNoteShareLink } from '@/models/models';

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

  it('shows disabled state when no link exists', () => {
    render(
      <ShareNoteModal
        isOpen
        note={createTestNote()}
        shareLink={undefined}
        onClose={jest.fn()}
        onCreate={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(screen.getByText('studiesWorkspace.shareLinks.statusOffTitle')).toBeInTheDocument();
    expect(screen.getByText('studiesWorkspace.shareLinks.createButton')).toBeInTheDocument();
  });

  it('creates a share link when the create button is clicked', async () => {
    const user = userEvent.setup();
    const onCreate = jest.fn().mockResolvedValue(createShareLink());

    render(
      <ShareNoteModal
        isOpen
        note={createTestNote()}
        shareLink={undefined}
        onClose={jest.fn()}
        onCreate={onCreate}
        onDelete={jest.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.createButton' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('note-1'));
  });

  it('shows active state when link exists', () => {
    render(
      <ShareNoteModal
        isOpen
        note={createTestNote()}
        shareLink={createShareLink()}
        onClose={jest.fn()}
        onCreate={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(screen.getByText('studiesWorkspace.shareLinks.statusOnTitle')).toBeInTheDocument();
    expect(screen.getByText('studiesWorkspace.shareLinks.copyLink')).toBeInTheDocument();
    expect(screen.getByText('studiesWorkspace.shareLinks.revokeLink')).toBeInTheDocument();
  });

  it('copies and revokes a link when active', async () => {
    const user = userEvent.setup();
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const copyToClipboard = jest.fn().mockResolvedValue(true);
    const shareLink = createShareLink();

    mockUseClipboard.mockReturnValue({
      isCopied: false,
      isLoading: false,
      error: null,
      copyToClipboard,
      reset: jest.fn(),
    });

    render(
      <ShareNoteModal
        isOpen
        note={createTestNote()}
        shareLink={shareLink}
        onClose={jest.fn()}
        onCreate={jest.fn()}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.copyLink' }));
    await waitFor(() =>
      expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining(shareLink.token))
    );

    await user.click(screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.revokeLink' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('link-1'));
  });
});
