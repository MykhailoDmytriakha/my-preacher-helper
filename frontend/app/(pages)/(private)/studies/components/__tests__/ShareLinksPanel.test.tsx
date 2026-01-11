import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useClipboard } from '@/hooks/useClipboard';
import { StudyNote, StudyNoteShareLink } from '@/models/models';

import ShareLinksPanel from '../ShareLinksPanel';

jest.mock('@/hooks/useClipboard', () => ({
  useClipboard: jest.fn(),
}));

const mockUseClipboard = useClipboard as jest.MockedFunction<typeof useClipboard>;

const createTestNote = (overrides: Partial<StudyNote> = {}): StudyNote => {
  const timestamp = new Date().toISOString();
  return {
    id: 'note-1',
    userId: 'user-1',
    content: 'Test content',
    title: 'Shared note title',
    scriptureRefs: [],
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    isDraft: false,
    ...overrides,
  };
};

const createShareLink = (overrides: Partial<StudyNoteShareLink> = {}): StudyNoteShareLink => {
  const timestamp = new Date().toISOString();
  return {
    id: 'link-1',
    noteId: 'note-1',
    ownerId: 'user-1',
    token: 'token-123',
    createdAt: timestamp,
    viewCount: 3,
    ...overrides,
  };
};

describe('ShareLinksPanel', () => {
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

  it('shows empty state when there are no links', () => {
    render(
      <ShareLinksPanel
        notes={[createTestNote()]}
        shareLinks={[]}
        onCreate={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(screen.getByText('studiesWorkspace.shareLinks.empty')).toBeInTheDocument();
  });

  it('shows loading state when loading and no links', () => {
    render(
      <ShareLinksPanel
        notes={[]}
        shareLinks={[]}
        loading={true}
        onCreate={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('creates a share link for the selected note and clears selection', async () => {
    const user = userEvent.setup();
    const onCreate = jest.fn().mockResolvedValue(createShareLink({ id: 'link-2', noteId: 'note-2' }));
    const notes = [createTestNote({ id: 'note-2', title: 'New note' })];

    render(
      <ShareLinksPanel
        notes={notes}
        shareLinks={[]}
        onCreate={onCreate}
        onDelete={jest.fn()}
      />
    );

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'note-2');
    await user.click(screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.createButton' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('note-2'));
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(''));
  });

  it('does not create a link when no note is selected', async () => {
    const user = userEvent.setup();
    const onCreate = jest.fn().mockResolvedValue(createShareLink());

    render(
      <ShareLinksPanel
        notes={[createTestNote()]}
        shareLinks={[]}
        onCreate={onCreate}
        onDelete={jest.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.createButton' }));

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('renders share links with note title and views', () => {
    const note = createTestNote();
    const link = createShareLink();

    render(
      <ShareLinksPanel
        notes={[note]}
        shareLinks={[link]}
        onCreate={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(screen.getByText(note.title as string)).toBeInTheDocument();
    expect(screen.getByText(`/share/notes/${link.token}`)).toBeInTheDocument();
    expect(screen.getByText('studiesWorkspace.shareLinks.accessValue')).toBeInTheDocument();
    expect(screen.getByText(String(link.viewCount))).toBeInTheDocument();
    expect(screen.getByText('studiesWorkspace.shareLinks.copyLink')).toBeInTheDocument();
  });

  it('renders fallback title, copies link, and prevents double delete', async () => {
    const user = userEvent.setup();
    let resolveDelete!: () => void;
    const onDelete = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );
    const link = createShareLink({ noteId: 'missing-note', token: 'token-456' });
    const copyToClipboard = jest.fn().mockResolvedValue(true);

    mockUseClipboard.mockReturnValue({
      isCopied: false,
      isLoading: false,
      error: null,
      copyToClipboard,
      reset: jest.fn(),
    });

    render(
      <ShareLinksPanel
        notes={[createTestNote({ id: 'note-2', title: 'Another note' })]}
        shareLinks={[link]}
        onCreate={jest.fn()}
        onDelete={onDelete}
      />
    );

    expect(screen.getByText('studiesWorkspace.untitled')).toBeInTheDocument();

    const copyButton = screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.copyLink' });
    await user.click(copyButton);

    await waitFor(() =>
      expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining(`/share/notes/${link.token}`))
    );
    await waitFor(() => expect(screen.getByText('common.copied')).toBeInTheDocument());

    const deleteButton = screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.deleteLink' });
    await user.click(deleteButton);
    await user.click(deleteButton);

    expect(onDelete).toHaveBeenCalledTimes(1);
    resolveDelete();
  });
});
