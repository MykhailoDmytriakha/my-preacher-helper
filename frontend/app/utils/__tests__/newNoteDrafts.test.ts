import { draftKey, isDraftStorageRefusedFor, readDraft, saveDraft } from '@/utils/durableDraft';
import { canResumeNewNoteDraft, findNewNoteDrafts, newNoteCreationId, newNoteDraftHref, newNoteDraftId, readNewNoteDraft, retireConfirmedNewNoteDrafts, validNewNoteDraftId } from '@/utils/newNoteDrafts';

import type { NoteDraftPayload } from '@/models/studyNoteDraft';

const value = (content: string): NoteDraftPayload => ({ title: '', content, tags: [], scriptureRefs: [], type: 'note' });
const put = (id: string, content: string, owner = 'owner') => saveDraft(draftKey(owner, newNoteDraftId(id), 'note'), value(content), id);
const discover = (represented: string[] = [], confirmed: string[] = []) => findNewNoteDrafts('owner', new Set(represented), new Set(confirmed));

beforeEach(() => localStorage.clear());
afterEach(() => { jest.restoreAllMocks(); localStorage.clear(); });

it('discovers both separately started notes, including equal words, newest first', () => {
  put('A', 'Same words'); put('B', 'Same words');
  expect(new Set(discover().map(draft => draft.docId))).toEqual(new Set(['new~A', 'new~B']));
});

it('keeps the precreate address distinct from the actual document address', () => {
  expect(newNoteDraftId('A')).not.toBe('A');
  expect(newNoteCreationId('new~A')).toBe('A');
  expect(newNoteDraftHref('new~A', 'owner')).toBe('/studies/new?draft=new~A&draftOwner=owner');
});

it.each(['A', '../A', 'new~', 'new~A:other', 'new~A/other', 'new~<script>'])('rejects an invalid selected draft address %s', id => {
  expect(validNewNoteDraftId(id)).toBeNull();
});

it('discovers the single ambiguous legacy new copy without inventing a target identity', () => {
  saveDraft(draftKey('owner', 'new', 'note'), value('Legacy words'));
  expect(discover()).toEqual([expect.objectContaining({ docId: 'new', value: value('Legacy words') })]);
  retireConfirmedNewNoteDrafts('owner', new Set(['A']));
  expect(discover()).toHaveLength(1);
});

it('omits empty visits, but keeps metadata-only work and the other owner isolated', () => {
  put('blank', ''); put('private', 'Other owner words', 'another-owner');
  saveDraft(draftKey('owner', 'new~meta', 'note'), { ...value(''), tags: ['remember'] }, 'meta');
  expect(discover().map(draft => draft.docId)).toEqual(['new~meta']);
});

it('does not present captured pending rows twice and does not retire their backup', () => {
  put('A', 'Pending words');
  expect(discover(['A'])).toEqual([]);
  retireConfirmedNewNoteDrafts('owner', new Set());
  expect(readDraft(draftKey('owner', 'new~A', 'note'))?.value).toEqual(value('Pending words'));
});

it('canonical acceptance retires only the matching precreate source, preserving independent equal words and later actual-id words', () => {
  put('A', 'Same words'); put('B', 'Same words');
  saveDraft(draftKey('owner', 'A', 'note'), value('Later words'), 'A');
  retireConfirmedNewNoteDrafts('owner', new Set(['A']));
  expect(readDraft(draftKey('owner', 'new~A', 'note'))).toBeNull();
  expect(readDraft<NoteDraftPayload>(draftKey('owner', 'A', 'note'))?.value.content).toBe('Later words');
  expect(discover([], ['A']).map(draft => draft.docId)).toEqual(['new~B']);
});

it('does not treat an ordinary note update or malformed record as an uncreated note', () => {
  saveDraft(draftKey('owner', 'actual-note', 'note'), value('Update'));
  saveDraft(draftKey('owner', 'new~wrong', 'note'), value('Different target'), 'A');
  saveDraft(draftKey('owner', 'new~bad', 'note'), { content: null }, 'bad');
  expect(discover()).toEqual([]);
  expect(readNewNoteDraft('owner', 'actual-note')).toBeNull();
});

it('storage refusal never evicts earlier note copies or invents a recoverable refused copy', () => {
  put('A', 'Kept words');
  const setItem = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, data) {
    if (key === draftKey('owner', 'new~B', 'note')) throw new DOMException('Full', 'QuotaExceededError');
    return setItem.call(this, key, data);
  });
  expect(put('B', 'Not durable')).toBe(false);
  expect(isDraftStorageRefusedFor('owner')).toBe(true);
  expect(discover().map(draft => draft.docId)).toEqual(['new~A']);
  jest.restoreAllMocks();
  // Settle the test's exact refused debt without changing other copies.
  put('B', 'Not durable');
  expect(isDraftStorageRefusedFor('owner')).toBe(false);
});

it('resume URLs require an owned local source, including owner-marked links', () => {
  expect(canResumeNewNoteDraft('owner', 'new~A', 'another-owner')).toBe(false);
  expect(canResumeNewNoteDraft('owner', 'new~A', null)).toBe(false);
  expect(canResumeNewNoteDraft('owner', 'new~A', 'owner')).toBe(false);
  put('A', 'Own words');
  expect(canResumeNewNoteDraft('owner', 'new~A', null)).toBe(true);
  expect(canResumeNewNoteDraft('owner', 'new~A', 'owner')).toBe(true);
  expect(canResumeNewNoteDraft('another-owner', 'new~A', null)).toBe(false);
  expect(canResumeNewNoteDraft('owner', 'new~represented', 'owner')).toBe(false);
  expect(canResumeNewNoteDraft('owner', 'new', 'owner')).toBe(false);
  expect(canResumeNewNoteDraft(undefined, 'new~A', 'owner')).toBe(false);
});
