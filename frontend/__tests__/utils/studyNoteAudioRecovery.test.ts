import { update } from 'idb-keyval';

import { clearDraft, draftKey, readDraft } from '@/utils/durableDraft';
import { findNewNoteDrafts } from '@/utils/newNoteDrafts';
import { deleteRecordingDraft, getRecordingDraft, listRecordingDrafts, saveRecordingDraft, saveRecordingDraftText } from '@/utils/recordingDraftStore';
import { copyRecordingIntoNewNote, isRecordingOnlyNoteDraft, unassignedStudyRecordingFilter } from '@/utils/studyNoteAudioRecovery';

const mockRows = new Map<string, any>();
jest.mock('idb-keyval', () => ({
  createStore: jest.fn(() => ({})),
  get: jest.fn(async (id: string) => mockRows.get(id)),
  entries: jest.fn(async () => [...mockRows]),
  update: jest.fn(async (id: string, change: (row: any) => any) => { mockRows.set(id, change(mockRows.get(id))); }),
}));
const blob = new Blob(['saved words'], { type: 'audio/webm' });
const original = async () => {
  await saveRecordingDraft({ id: 'original', ownerId: 'alice', blob, mimeType: blob.type, context: 'study', contextId: 'new' });
  await saveRecordingDraftText('original', 'alice', 'Cached original words');
};
beforeEach(() => {
  localStorage.clear(); mockRows.clear(); jest.clearAllMocks();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const key of Object.keys(localStorage)) clearDraft(key);
  for (const row of mockRows.values()) if (row.contextId !== 'new') clearDraft(draftKey('alice', `new~${row.contextId}`, 'note'));
  localStorage.clear();
});

it('copies to a distinct raw source and creation target while retaining the playable cached original', async () => {
  await original();
  const href = await copyRecordingIntoNewNote('original', 'alice');
  const url = new URL(href, 'http://localhost');
  const docId = url.searchParams.get('draft')!;
  const stored = readDraft<{ recordingSourceIds: string[] }>(draftKey('alice', docId, 'note'))!;
  const copyId = stored.value.recordingSourceIds[0];
  expect(url.searchParams.get('draftOwner')).toBe('alice');
  expect(docId).toBe(`new~${stored.creationTargetId}`);
  expect(stored.creationTargetId).not.toBe('new');
  expect(copyId).not.toBe('original');
  expect(await getRecordingDraft(copyId, 'alice')).toEqual(expect.objectContaining({ blob, transcript: 'Cached original words', contextId: stored.creationTargetId }));
  expect(await getRecordingDraft('original', 'alice')).toEqual(expect.objectContaining({ blob, transcript: 'Cached original words', contextId: 'new' }));
  expect(findNewNoteDrafts('alice', new Set(), new Set())).toHaveLength(1);
  expect(isRecordingOnlyNoteDraft(findNewNoteDrafts('alice', new Set(), new Set())[0].value)).toBe(true);
});

it('an old note acknowledgement cannot retire the copied draft or its new raw source', async () => {
  await original();
  localStorage.setItem(draftKey('alice', 'new~old-note', 'note'), JSON.stringify({ savedAt: 1, creationTargetId: 'old-note',
    value: { title: '', content: '', tags: [], scriptureRefs: [], type: 'note', recordingSourceIds: ['original'] } }));
  await copyRecordingIntoNewNote('original', 'alice');
  const copy = findNewNoteDrafts('alice', new Set(), new Set()).find(draft => draft.creationTargetId !== 'old-note')!;
  expect(copy.creationTargetId).not.toBe('old-note');
  await deleteRecordingDraft('original', 'alice');
  const kept = findNewNoteDrafts('alice', new Set(), new Set(['old-note']));
  expect(kept.find(draft => draft.docId === copy.docId)?.value).toEqual(copy.value);
  expect(kept.find(draft => draft.creationTargetId === 'old-note')?.created).toBe(true);
  expect((await getRecordingDraft(copy.value.recordingSourceIds![0], 'alice'))?.blob).toBe(blob);
});

it.each(['bob', ''])('refuses to copy another owner recording for %s', async owner => {
  await original();
  await expect(copyRecordingIntoNewNote('original', owner)).rejects.toThrow();
  expect(mockRows.size).toBe(1); expect(localStorage.length).toBe(0);
});

it('keeps an ownerless legacy source hidden and unchanged', async () => {
  mockRows.set('ownerless', { id: 'ownerless', blob, context: 'study', contextId: 'new', mimeType: blob.type, sizeBytes: blob.size, createdAt: 1 });
  expect(await listRecordingDrafts({ ownerId: 'alice', context: 'study' })).toEqual([]);
  await expect(copyRecordingIntoNewNote('ownerless', 'alice')).rejects.toThrow();
  expect(mockRows.get('ownerless').ownerId).toBeUndefined(); expect(mockRows.size).toBe(1);
});

it('does not advertise a draft when IndexedDB refuses the raw copy', async () => {
  await original();
  jest.mocked(update).mockRejectedValueOnce(new Error('IDB refused'));
  await expect(copyRecordingIntoNewNote('original', 'alice')).rejects.toThrow('IDB refused');
  expect(localStorage.length).toBe(0); expect((await getRecordingDraft('original', 'alice'))?.blob).toBe(blob);
});

it('retains original and copied raw when caching the transcript fails', async () => {
  await original();
  const perform = jest.mocked(update).getMockImplementation()!;
  jest.mocked(update).mockImplementationOnce(perform).mockRejectedValueOnce(new Error('Transcript refused'));
  await expect(copyRecordingIntoNewNote('original', 'alice')).rejects.toThrow('Transcript refused');
  expect(localStorage.length).toBe(0); expect(mockRows.size).toBe(2);
  expect((await getRecordingDraft('original', 'alice'))?.transcript).toBe('Cached original words');
});

it('refuses navigation without metadata storage and retains both playable sources', async () => {
  await original();
  jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Local storage full'); });
  await expect(copyRecordingIntoNewNote('original', 'alice')).rejects.toThrow('local draft');
  expect(localStorage.length).toBe(0); expect(mockRows.size).toBe(2);
  expect((await getRecordingDraft('original', 'alice'))?.blob).toBe(blob);
});

it('excludes sources and destinations owned by visible notes or unfinished drafts', async () => {
  await original();
  await copyRecordingIntoNewNote('original', 'alice');
  const drafts = findNewNoteDrafts('alice', new Set(), new Set());
  const ownCopy = await getRecordingDraft(drafts[0].value.recordingSourceIds![0], 'alice');
  const filter = unassignedStudyRecordingFilter([{ id: 'saved-note', recordingSourceIds: ['linked-original'] }], drafts);
  const row = mockRows.get('original');
  expect(filter(row)).toBe(true);
  expect(filter(ownCopy!)).toBe(false);
  expect(filter({ ...row, id: 'linked-original' })).toBe(false);
  expect(filter({ ...row, id: 'unlinked-but-owned', contextId: 'saved-note' })).toBe(false);
  expect(filter({ ...row, id: 'other-context', context: 'thought' })).toBe(false);
});

it.each([{ title: 'Authored title' }, { content: 'Authored words' }, { tags: ['tag'] }, { scriptureRefs: [{ book: 'John', chapter: 1 }] }, { dictationSourceIds: ['represented-words'] }, { type: 'question' }])('does not treat authored or represented work as audio-only: %p', patch => {
  expect(isRecordingOnlyNoteDraft({ title: '', content: '', tags: [], scriptureRefs: [], type: 'note', recordingSourceIds: ['raw'], ...patch } as Parameters<typeof isRecordingOnlyNoteDraft>[0])).toBe(false);
});
