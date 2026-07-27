import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { OutboxConflictBanner } from '@/components/OutboxConflictBanner';
import { conflictSafeUpdate } from '@/services/conflictSafeUpdate.client';
import { enqueueWrite, listOutbox } from '@/services/writeOutbox.client';
import '@testing-library/jest-dom';

/**
 * A queue nobody drains is not a safety net — it is where text goes to die.
 * These pin the ONE path that may overwrite (a human choosing "keep mine") and
 * the one that may discard (a human choosing "take theirs").
 */
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('firebase/firestore', () => ({ doc: (_db: unknown, c: string, id: string) => ({ __p: `${c}/${id}` }) }));
jest.mock('@/services/conflictSafeUpdate.client', () => ({
  conflictSafeUpdate: jest.fn(),
  isStaleWriteError: () => false,
}));
// The banner refreshes what the replay wrote, so it needs a QueryClient.
const mockInvalidate = jest.fn().mockResolvedValue(undefined);
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: (...args: unknown[]) => mockInvalidate(...args) }),
}));
jest.mock('@/services/seriesMembership.client', () => ({
  replayMembershipOutbox: jest.fn().mockResolvedValue(0),
}));
jest.mock('@/services/outboxReplay.client', () => {
  const actual = jest.requireActual('@/services/writeOutbox.client');
  return {
    replayOutbox: jest.fn().mockResolvedValue({ replayed: 0, conflicted: 0, failed: 0, touched: [] }),
    pendingOutboxConflicts: (uid: string) =>
      actual.listOutbox(uid).filter((e: { status: string }) => e.status === 'conflicted'),
  };
});

const mockGuardedWrite = conflictSafeUpdate as jest.MockedFunction<typeof conflictSafeUpdate>;

const conflicted = () =>
  enqueueWrite({
    id: 'sermons:s1:core:u1',
    uid: 'u1',
    collection: 'sermons',
    docId: 's1',
    aggregate: 'core',
    patch: { verse: 'typed on a train' },
    baseRevision: 4,
    actualRevision: 7,
    status: 'conflicted',
    savedAt: 1,
  });

describe('OutboxConflictBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGuardedWrite.mockReset();
    mockGuardedWrite.mockResolvedValue(8);
  });

  it('shows the refused offline text instead of leaving it buried in the queue', async () => {
    conflicted();
    render(<OutboxConflictBanner />);

    expect(await screen.findByText('freshness.conflictTitle')).toBeInTheDocument();
    expect(screen.getByText('typed on a train')).toBeInTheDocument();
  });

  it('shows nothing when the queue holds no refusal', () => {
    render(<OutboxConflictBanner />);
    expect(screen.queryByText('freshness.conflictTitle')).not.toBeInTheDocument();
  });

  it('overwrites ONLY on an explicit choice, stating the revision seen at refusal', async () => {
    conflicted();
    render(<OutboxConflictBanner />);
    await screen.findByText('freshness.conflictTitle');

    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));

    await waitFor(() => expect(mockGuardedWrite).toHaveBeenCalled());
    const [, patch, , options] = mockGuardedWrite.mock.calls[0];
    expect(patch).toEqual({ verse: 'typed on a train' });
    // 7 — the revision the server held when it refused; 4 would be refused again.
    expect(options).toEqual({ aggregate: 'core', expectedRevision: 7 });
    await waitFor(() => expect(listOutbox('u1')).toHaveLength(0));
  });

  it('keeps the entry when the deliberate overwrite itself fails', async () => {
    conflicted();
    mockGuardedWrite.mockRejectedValue(new Error('permission denied'));
    render(<OutboxConflictBanner />);
    await screen.findByText('freshness.conflictTitle');

    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));

    await waitFor(() => expect(mockGuardedWrite).toHaveBeenCalled());
    expect(listOutbox('u1')).toHaveLength(1);
  });

  it('discards the intent only when the person takes the other version', async () => {
    conflicted();
    render(<OutboxConflictBanner />);
    await screen.findByText('freshness.conflictTitle');

    fireEvent.click(screen.getByText('freshness.conflictTakeTheirs'));

    await waitFor(() => expect(listOutbox('u1')).toHaveLength(0));
    expect(mockGuardedWrite).not.toHaveBeenCalled();
  });
});

/**
 * A queued edit whose document was DELETED on another device.
 *
 * The panel must not offer "keep mine": updating a document that no longer exists
 * fails every time, so the button would promise something it can never do. What the
 * person needs is their words, and an explicit discard.
 */
describe('when the target document is gone', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGuardedWrite.mockReset();
  });

  const deletedTarget = () =>
    enqueueWrite({
      id: 'sermons:gone:core:u1',
      uid: 'u1',
      collection: 'sermons',
      docId: 'gone',
      aggregate: 'core',
      patch: { title: 'the title I typed on the train' },
      baseRevision: 4,
      status: 'conflicted',
      targetMissing: true,
      savedAt: 1,
    });

  it('shows the text and never offers an impossible overwrite', async () => {
    deletedTarget();
    render(<OutboxConflictBanner />);

    expect(await screen.findByText('freshness.deletedElsewhereTitle')).toBeInTheDocument();
    expect(screen.getByText(/the title I typed on the train/)).toBeInTheDocument();
    expect(screen.queryByText('freshness.conflictKeepMine')).not.toBeInTheDocument();
    expect(screen.getByText('freshness.copyTextAction')).toBeInTheDocument();
  });

  it('discards only when the person says so, and never writes', async () => {
    deletedTarget();
    render(<OutboxConflictBanner />);

    fireEvent.click(await screen.findByText('freshness.discardAction'));

    await waitFor(() => expect(listOutbox('u1')).toHaveLength(0));
    expect(mockGuardedWrite).not.toHaveBeenCalled();
  });
});

describe('recovery of a deleted target is LOSSLESS', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGuardedWrite.mockReset();
  });

  it('shows the text inside arrays too, not only top-level strings', async () => {
    // A group's block text lives in `templates`/`flow`. The panel used to build its
    // preview from top-level strings only, so "copy my text" returned a summary while
    // the actual paragraphs stayed invisible — and discarding then lost them.
    enqueueWrite({
      id: 'groups:gone:content:u1',
      uid: 'u1',
      collection: 'groups',
      docId: 'gone',
      aggregate: 'content',
      patch: {
        title: 'Wednesday group',
        flow: [{ id: 'b1', text: 'the paragraph I wrote on the train' }],
      },
      baseRevision: 2,
      status: 'conflicted',
      targetMissing: true,
      savedAt: 1,
    });

    render(<OutboxConflictBanner />);

    expect(await screen.findByText(/the paragraph I wrote on the train/)).toBeInTheDocument();
  });
});

/**
 * THE ORDINARY REFUSAL PANEL HAS THE SAME TWO DUTIES.
 *
 * It showed a one-line preview built from top-level strings, so a group's block text —
 * which lives inside `flow`/`templates` arrays — was invisible: the person chose between
 * "keep mine" and "take theirs" without being able to see what "mine" even was. And
 * "take theirs" only deleted the queued intent; it never loaded the other version, so
 * the screen kept showing the value that had just been thrown away.
 */
describe('the ordinary refusal panel shows everything and loads theirs', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGuardedWrite.mockReset();
    mockGuardedWrite.mockResolvedValue(8);
    mockInvalidate.mockReset();
    mockInvalidate.mockResolvedValue(undefined);
  });

  const conflictedGroup = () =>
    enqueueWrite({
      id: 'groups:g1:content:u1',
      uid: 'u1',
      collection: 'groups',
      docId: 'g1',
      aggregate: 'content',
      patch: {
        title: 'Wednesday group',
        flow: [{ id: 'b1', text: 'the paragraph I wrote on the train' }],
      },
      baseRevision: 2,
      actualRevision: 5,
      status: 'conflicted',
      savedAt: 1,
    });

  it('shows text buried inside arrays, not only the top-level strings', async () => {
    conflictedGroup();
    render(<OutboxConflictBanner />);

    await screen.findByText('freshness.conflictTitle');
    expect(screen.getByText(/the paragraph I wrote on the train/)).toBeInTheDocument();
  });

  it('loads the other version before discarding the refused text', async () => {
    conflictedGroup();
    render(<OutboxConflictBanner />);
    await screen.findByText('freshness.conflictTitle');

    fireEvent.click(screen.getByText('freshness.conflictTakeTheirs'));

    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled());
    await waitFor(() => expect(listOutbox('u1')).toHaveLength(0));
  });

  it('KEEPS the refused text when loading the other version fails', async () => {
    // Otherwise "take theirs" throws away the only copy and shows the person their own
    // stale value, with nothing left to recover.
    conflictedGroup();
    mockInvalidate.mockRejectedValueOnce(new Error('offline again'));
    render(<OutboxConflictBanner />);
    await screen.findByText('freshness.conflictTitle');

    fireEvent.click(screen.getByText('freshness.conflictTakeTheirs'));

    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled());
    expect(listOutbox('u1')).toHaveLength(1);
  });
});
