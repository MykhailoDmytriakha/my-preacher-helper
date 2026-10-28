import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import UnfinishedNoteDrafts from '@/(pages)/(private)/studies/components/UnfinishedNoteDrafts';
import UnreadableNoteDrafts from '@/(pages)/(private)/studies/components/UnreadableNoteDrafts';
import { copyPlainText } from '@/utils/clipboard';
import { draftKey } from '@/utils/durableDraft';
import { findNoteDraftCopies } from '@/utils/newNoteDrafts';

jest.mock('@/utils/clipboard', () => ({ copyPlainText: jest.fn() }));
jest.mock('@/(pages)/(private)/studies/components/UnassignedNoteRecordings', () => ({ __esModule: true, default: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const keep = (owner = 'owner', documentId = 'note', writerId?: string) => {
  const key = draftKey(owner, documentId, 'note', writerId);
  const value = { title: 'Kept title', content: 'Kept words', tags: [], scriptureRefs: [null], type: 'note' };
  const raw = JSON.stringify({ value, savedAt: 1, ...(documentId.startsWith('new~') ? { creationTargetId: documentId.slice(4) } : {}) }, null, 2);
  localStorage.setItem(key, raw);
  return { key, raw };
};
beforeEach(() => { localStorage.clear(); jest.mocked(copyPlainText).mockReset().mockResolvedValue(undefined); });
afterEach(() => { jest.restoreAllMocks(); localStorage.clear(); });

it('copies readable words and the exact original bytes without applying or changing the source', async () => {
  const { key, raw } = keep('owner', 'note', 'old-opening');
  render(<UnreadableNoteDrafts owner="owner" documentId="note" />);
  expect(screen.getByText('Kept words')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'unsavedDraft.restore' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.copyText' }));
  await waitFor(() => expect(copyPlainText).toHaveBeenCalledWith('Kept title\n\nKept words'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('common.copied'));
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.copyOriginal' }));
  await waitFor(() => expect(copyPlainText).toHaveBeenLastCalledWith(raw));
  expect(localStorage.getItem(key)).toBe(raw);
});

it('hides a previous owner and another document while leaving every original intact', () => {
  const own = keep();
  const foreign = keep('other');
  const view = render(<UnreadableNoteDrafts owner="owner" documentId="note" />);
  expect(screen.getAllByText('Kept words')).toHaveLength(1);
  view.rerender(<UnreadableNoteDrafts owner="owner" documentId="another-note" />);
  expect(screen.queryByText('Kept words')).not.toBeInTheDocument();
  view.rerender(<UnreadableNoteDrafts owner={null} documentId="note" />);
  expect(screen.queryByText('Kept words')).not.toBeInTheDocument();
  expect(localStorage.getItem(own.key)).toBe(own.raw);
  expect(localStorage.getItem(foreign.key)).toBe(foreign.raw);
});

it('keeps invalid unfinished new-note text visible in the notes list', () => {
  const { key, raw } = keep('owner', 'new~A');
  render(<UnfinishedNoteDrafts uid="owner" notes={[]} />);
  expect(screen.getByText('Kept words')).toBeVisible();
  expect(screen.getByRole('button', { name: 'unsavedDraft.copyOriginal' })).toBeVisible();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe(raw);
});

it('reports failed copying and keeps the original available for reading', async () => {
  const { key, raw } = keep();
  jest.mocked(copyPlainText).mockRejectedValue(new Error('Clipboard refused'));
  render(<UnreadableNoteDrafts owner="owner" documentId="note" />);
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.copyOriginal' }));
  expect(await screen.findByText('legacyRecovery.actionFailed')).toBeVisible();
  expect(screen.getByText('Kept words')).toBeVisible();
  expect(localStorage.getItem(key)).toBe(raw);
});

it('preserves a visible source when a focus refresh cannot read storage', () => {
  const { key, raw } = keep();
  render(<UnreadableNoteDrafts owner="owner" documentId="note" />);
  const read = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage refused'); });
  act(() => { window.dispatchEvent(new Event('focus')); });
  expect(screen.getByText('legacyRecovery.actionFailed')).toBeVisible();
  expect(screen.getByText('Kept words')).toBeVisible();
  read.mockRestore();
  expect(localStorage.getItem(key)).toBe(raw);
});

it('still offers a valid legacy Bible reference and tags through normal recovery', () => {
  const key = draftKey('owner', 'note', 'note');
  const value = { title: '', content: 'Valid words', tags: ['topic'], scriptureRefs: [{ id: 'ref', book: 'John', chapter: 3, fromVerse: 16 }], type: 'note' };
  const raw = JSON.stringify({ value, savedAt: 1 });
  localStorage.setItem(key, raw);
  expect(findNoteDraftCopies('owner', 'note', 'note').map(copy => copy.value)).toEqual([value]);
  render(<UnreadableNoteDrafts owner="owner" documentId="note" />);
  expect(screen.queryByText('unsavedDraft.unreadableTitle')).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBe(raw);
});
