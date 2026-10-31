import { draftKey, isDraftStorageRefusedFor, readDraft, saveDraft } from '@/utils/durableDraft';
import { canResumeNewNoteDraft, findNewNoteDrafts, findNoteDraftCopies, newNoteCreationId, newNoteDraftHref, newNoteDraftId, readNewNoteDraft, validNewNoteDraftId } from '@/utils/newNoteDrafts';

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

it('finds every separately kept opening of one unfinished new note', () => {
  put('A', 'Legacy source');
  saveDraft(draftKey('owner', 'new~A', 'note', 'opening-a'), value('First scoped source'), 'A');
  saveDraft(draftKey('owner', 'new~A', 'note', 'opening-b'), value('Second scoped source'), 'A');
  expect(discover().map(copy => copy.value.content).sort()).toEqual(['First scoped source', 'Legacy source', 'Second scoped source']);
});

it('can resume an owned scoped source without requiring a shared legacy slot', () => {
  saveDraft(draftKey('owner', 'new~A', 'note', 'opening-a'), value('Scoped unfinished words'), 'A');
  expect(canResumeNewNoteDraft('owner', 'new~A', 'owner')).toBe(true);
  expect(canResumeNewNoteDraft('other', 'new~A', 'owner')).toBe(false);
});

it('maps only owned matching precreate copies to an actual note without rewriting them', () => {
  put('A', 'Legacy A');
  saveDraft(draftKey('owner', 'new~A', 'note', 'opening-a'), value('Scoped A'), 'A');
  saveDraft(draftKey('owner', 'A', 'note', 'active'), value('Actual A'));
  put('B', 'Other note'); put('A', 'Other owner', 'other');
  const before = new Map(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]));
  expect(findNoteDraftCopies('owner', 'A', 'note').map(copy => copy.value.content).sort()).toEqual(['Actual A', 'Legacy A', 'Scoped A']);
  expect(findNoteDraftCopies('owner', 'A', 'conflict:note')).toEqual([]);
  expect(new Map(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))).toEqual(before);
});

it('never selects a foreign physical copy for an owned resume link', () => {
  put('A', 'Own source');
  const foreign = draftKey('other', 'new~A', 'note', 'foreign');
  saveDraft(foreign, value('Foreign source'), 'A');
  expect(canResumeNewNoteDraft('owner', 'new~A', 'owner', foreign)).toBe(false);
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
  discover([], ['A']);
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
  discover(['A']);
  expect(readDraft(draftKey('owner', 'new~A', 'note'))?.value).toEqual(value('Pending words'));
});

it('creation identity alone keeps unknown precreate words and preserves independent later copies', () => {
  put('A', 'Same words'); put('B', 'Same words');
  saveDraft(draftKey('owner', 'A', 'note'), value('Later words'), 'A');
  discover([], ['A']);
  expect(readDraft(draftKey('owner', 'new~A', 'note'))?.value).toEqual(value('Same words'));
  expect(readDraft<NoteDraftPayload>(draftKey('owner', 'A', 'note'))?.value.content).toBe('Later words');
  expect(discover(['A'], ['A']).map(draft => draft.docId)).toEqual(['new~B']);
  expect(discover([], ['A']).find(draft => draft.docId === 'new~A')?.created).toBe(true);
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

it('sorts a current note and its carried precreate source by edit time, not stored-write time', () => {
  const currentKey = draftKey('owner', 'A', 'note', 'current-opening');
  const sourceKey = draftKey('owner', newNoteDraftId('A'), 'note', 'precreate-opening');
  const clock = jest.spyOn(Date, 'now')
    .mockReturnValueOnce(200)
    .mockReturnValueOnce(100);
  saveDraft(currentKey, value('Earlier current-address edit'), undefined, false, 10);
  saveDraft(sourceKey, value('Later precreate edit'), 'A', false, 20);

  expect(readDraft(currentKey)?.savedAt).toBe(200);
  expect(readDraft(sourceKey)?.savedAt).toBe(100);
  expect(findNoteDraftCopies('owner', 'A', 'note').map(copy => copy.value.content))
    .toEqual(['Later precreate edit', 'Earlier current-address edit']);
  clock.mockRestore();
});
