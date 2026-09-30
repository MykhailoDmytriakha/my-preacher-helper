import {
  clearDraft,
  clearDraftIfMatches,
  clearDraftsForOwner,
  draftKey,
  isDraftStorageRefused,
  listDraftKeys,
  moveDraft,
  readDraft,
  saveDraft,
} from '@/utils/durableDraft';

describe('durableDraft', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a value', () => {
    const key = draftKey('uid-1', 'note-1', 'note');
    saveDraft(key, { title: 'hello' });

    expect(readDraft<{ title: string }>(key)?.value).toEqual({ title: 'hello' });
  });

  it('returns null when nothing was stored', () => {
    expect(readDraft(draftKey('uid-1', 'note-1', 'note'))).toBeNull();
  });

  it('scopes drafts by owner, so another account cannot read the previous one', () => {
    // The bug the existing `prep-draft-backup-<sermonId>` key has: no uid, so on a
    // shared computer the next account opens the previous account's text.
    const mine = draftKey('uid-1', 'note-1', 'note');
    const theirs = draftKey('uid-2', 'note-1', 'note');
    saveDraft(mine, { title: 'my private text' });

    expect(readDraft(theirs)).toBeNull();
  });

  it('scopes drafts by aggregate within one document', () => {
    const outline = draftKey('uid-1', 'sermon-1', 'outline');
    const prep = draftKey('uid-1', 'sermon-1', 'prep');
    saveDraft(outline, { text: 'outline text' });

    expect(readDraft(prep)).toBeNull();
    expect(readDraft<{ text: string }>(outline)?.value).toEqual({ text: 'outline text' });
  });

  it('clears a draft when the confirmed value matches', () => {
    const key = draftKey('uid-1', 'note-1', 'note');
    saveDraft(key, { title: 'saved text' });

    clearDraftIfMatches(key, { title: 'saved text' });

    expect(readDraft(key)).toBeNull();
  });

  it('KEEPS a draft when the confirmed value differs — the two-tab safety net', () => {
    // Tab A and tab B share the key. B typed last, so the stored draft is B's.
    // When A's save succeeds it must retire only A's own text; clearing
    // unconditionally would destroy B's unsaved work.
    const key = draftKey('uid-1', 'note-1', 'note');
    saveDraft(key, { title: 'text typed in tab B' });

    clearDraftIfMatches(key, { title: 'text saved by tab A' });

    expect(readDraft<{ title: string }>(key)?.value).toEqual({ title: 'text typed in tab B' });
  });

  it('clears unconditionally when the user discards', () => {
    const key = draftKey('uid-1', 'note-1', 'note');
    saveDraft(key, { title: 'abandoned' });

    clearDraft(key);

    expect(readDraft(key)).toBeNull();
  });

  it('removes only the given owner drafts on logout', () => {
    saveDraft(draftKey('uid-1', 'note-1', 'note'), { a: 1 });
    saveDraft(draftKey('uid-1', 'note-2', 'note'), { a: 2 });
    saveDraft(draftKey('uid-2', 'note-3', 'note'), { a: 3 });

    clearDraftsForOwner('uid-1');

    expect(readDraft(draftKey('uid-1', 'note-1', 'note'))).toBeNull();
    expect(readDraft(draftKey('uid-1', 'note-2', 'note'))).toBeNull();
    expect(readDraft<{ a: number }>(draftKey('uid-2', 'note-3', 'note'))?.value).toEqual({ a: 3 });
  });

  it('ignores unparsable stored data instead of throwing', () => {
    const key = draftKey('uid-1', 'note-1', 'note');
    window.localStorage.setItem(key, '{not json');

    expect(readDraft(key)).toBeNull();
  });

  it('never removes another draft to make room: the new copy is reported as not kept instead', () => {
    // BUG-20260928-draft-eviction-drops-unseen-drafts: a draft from an earlier session may be the
    // only copy of text nobody has seen since; the one being written duplicates an open editor.
    const unseen = draftKey('uid-1', 'note-old', 'note');
    saveDraft(unseen, { old: true });
    const key = draftKey('uid-1', 'note-new', 'note');

    const real = Storage.prototype.setItem;
    const spy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function mocked(this: Storage, k: string, v: string) {
        // Full: nothing new fits until something else is freed.
        if (k === key) throw new DOMException('quota', 'QuotaExceededError');
        return real.call(this, k, v);
      });

    let kept = true;
    expect(() => { kept = saveDraft(key, { fresh: true }); }).not.toThrow();

    expect(kept).toBe(false);
    expect(isDraftStorageRefused()).toBe(true);
    expect(readDraft<{ old: boolean }>(unseen)?.value).toEqual({ old: true });
    spy.mockRestore();
    clearDraft(key);
  });

  it('keeps warning about newer refused text when an older stored draft is confirmed', () => {
    const key = draftKey('uid-1', 'note-1', 'note');
    saveDraft(key, { text: 'A' });
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    saveDraft(key, { text: 'B' }); // B has no durable copy
    spy.mockRestore();

    clearDraftIfMatches(key, { text: 'A' }); // A's save lands

    expect(isDraftStorageRefused()).toBe(true);
    clearDraft(key);
  });

  it('lists only its own keys, leaving unrelated storage alone', () => {
    window.localStorage.setItem('some-other-app-key', 'x');
    saveDraft(draftKey('uid-1', 'note-1', 'note'), { a: 1 });

    expect(listDraftKeys(window.localStorage)).toEqual([draftKey('uid-1', 'note-1', 'note')]);
    expect(window.localStorage.getItem('some-other-app-key')).toBe('x');
  });

  it('never evicts a refused-save record to make room', () => {
    // An ordinary draft duplicates text still visible in an editor; a conflict
    // record is the last copy of text the server turned away. Freeing space by
    // deleting it trades the original for a backup.
    // ONLY a conflict record is stored, so it is the only eviction candidate:
    // if conflicts were evictable this would delete it, and the test would fail.
    saveDraft(draftKey('u1', 'sermon-1', 'conflict:core'), {
      payload: { value: 'refused text' },
      actualRevision: 4,
    });

    const original = Storage.prototype.setItem;
    let firstAttempt = true;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (firstAttempt && k.includes('note-2')) {
        firstAttempt = false;
        throw new DOMException('QuotaExceededError');
      }
      return original.call(this, k, v);
    });

    try {
      saveDraft(draftKey('u1', 'note-2', 'note'), { text: 'a big new draft' });
    } finally {
      (Storage.prototype.setItem as jest.Mock).mockRestore();
    }

    expect(readDraft(draftKey('u1', 'sermon-1', 'conflict:core'))).not.toBeNull();
  });

});

describe('moveDraft — a new note keeps a durable home while its id changes', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('carries the record to the new key and retires the old one', () => {
    saveDraft(draftKey('u1', 'new', 'note'), { title: 'half a thought' });

    moveDraft(draftKey('u1', 'new', 'note'), draftKey('u1', 'real-id', 'note'));

    expect(readDraft(draftKey('u1', 'real-id', 'note'))?.value).toEqual({ title: 'half a thought' });
    expect(readDraft(draftKey('u1', 'new', 'note'))).toBeNull();
  });

  it('leaves an existing destination alone when there is nothing to carry', () => {
    saveDraft(draftKey('u1', 'real-id', 'note'), { title: 'text the editor is holding' });

    moveDraft(draftKey('u1', 'new', 'note'), draftKey('u1', 'real-id', 'note'));

    expect(readDraft(draftKey('u1', 'real-id', 'note'))?.value).toEqual({
      title: 'text the editor is holding',
    });
  });

  it('keeps the source when the destination could not be written', () => {
    // `saveDraft` never throws — out of room it logs and gives up. Clearing the
    // source anyway would leave the text with NO durable copy at all, which is worse
    // than never moving it.
    saveDraft(draftKey('u1', 'new', 'note'), { title: 'half a thought' });
    const setItem = jest
      .spyOn(window.localStorage.__proto__, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    moveDraft(draftKey('u1', 'new', 'note'), draftKey('u1', 'real-id', 'note'));

    setItem.mockRestore();
    expect(readDraft(draftKey('u1', 'new', 'note'))?.value).toEqual({ title: 'half a thought' });
    consoleError.mockRestore();
  });
});

describe('a device that refuses to keep drafts', () => {
  afterEach(() => { jest.restoreAllMocks(); localStorage.clear(); });

  it('says so instead of pretending the copy landed, and says it is fine again once one lands', () => {
    // A fresh module: the refusal state is app-wide and would otherwise carry other tests' keys.
    let fresh!: typeof import('../durableDraft');
    jest.isolateModules(() => { fresh = jest.requireActual('../durableDraft'); });
    const { saveDraft, isDraftStorageRefused, subscribeDraftStorage, clearDraft } = fresh;
    const heard = jest.fn();
    const stop = subscribeDraftStorage(heard);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(saveDraft('draft:v1:u:d:a', 'typed')).toBe(false);
    expect(isDraftStorageRefused()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    jest.mocked(Storage.prototype.setItem).mockRestore();
    // Another draft landing does not hide the one still owed a copy.
    expect(saveDraft('draft:v1:u:d:b', 'small')).toBe(true);
    expect(isDraftStorageRefused()).toBe(true);
    expect(saveDraft('draft:v1:u:d:a', 'typed')).toBe(true);
    expect(isDraftStorageRefused()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    // A retired draft is no longer owed a copy either.
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    saveDraft('draft:v1:u:d:c', 'refused');
    expect(isDraftStorageRefused()).toBe(true);
    clearDraft('draft:v1:u:d:c');
    expect(isDraftStorageRefused()).toBe(false);
    stop();
  });

  it('stops owing a copy once the server confirms the very text that was refused', () => {
    let fresh!: typeof import('../durableDraft');
    jest.isolateModules(() => { fresh = jest.requireActual('../durableDraft'); });
    const { saveDraft, isDraftStorageRefused, clearDraftIfMatches } = fresh;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    saveDraft('draft:v1:u:d:a', 'refused text');
    // Confirming OTHER text says nothing about the refused one.
    clearDraftIfMatches('draft:v1:u:d:a', 'older text');
    expect(isDraftStorageRefused()).toBe(true);
    clearDraftIfMatches('draft:v1:u:d:a', 'refused text');
    expect(isDraftStorageRefused()).toBe(false);
  });

  it('carries a refused copy\'s debt to the key a new document is saved under', () => {
    let fresh!: typeof import('../durableDraft');
    jest.isolateModules(() => { fresh = jest.requireActual('../durableDraft'); });
    const { saveDraft, isDraftStorageRefused, clearDraftIfMatches, moveDraft } = fresh;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    saveDraft('draft:v1:u:new:note', 'first words');
    // The note is created and adopts its real id; the server then confirms the text there.
    moveDraft('draft:v1:u:new:note', 'draft:v1:u:n1:note');
    clearDraftIfMatches('draft:v1:u:n1:note', 'first words');
    expect(isDraftStorageRefused()).toBe(false);
  });
});

