type Drafts = typeof import('@/utils/durableDraft');
let drafts: Drafts;

beforeEach(() => {
  localStorage.clear();
  jest.isolateModules(() => { drafts = jest.requireActual<Drafts>('@/utils/durableDraft'); });
});
afterEach(() => { jest.restoreAllMocks(); });

describe('independent durable draft copies', () => {
  it('keeps both openings and the legacy copy while one opening continues typing', () => {
    const legacy = drafts.draftKey('owner', 'note', 'note');
    const first = drafts.draftKey('owner', 'note', 'note', 'opening-a');
    const second = drafts.draftKey('owner', 'note', 'note', 'opening-b');
    drafts.saveDraft(legacy, 'Older unbound words');
    drafts.saveDraft(first, 'First words');
    drafts.saveDraft(second, 'Second words');
    drafts.saveDraft(first, 'First continued');
    expect(drafts.findDraftCopies<string>('owner', 'note', 'note').map(copy => copy.value).sort())
      .toEqual(['First continued', 'Older unbound words', 'Second words']);
    expect(drafts.findDraftDocIds('owner', 'note')).toEqual(['note']);
    expect(drafts.listDraftKeys()).toHaveLength(3);
  });

  it('keeps the original envelope separate from reader presentation fields', () => {
    const key = drafts.draftKey('owner', 'new', 'note');
    const original = { value: 'Words', savedAt: 1, unknownMetadata: { retained: true } };
    localStorage.setItem(key, JSON.stringify(original));
    const [copy] = drafts.findDraftCopies<string>('owner', 'new', 'note');
    const projected = { ...copy, docId: 'new', created: false };
    expect(projected.sourceRecord).toEqual(original);
    drafts.clearDraftIfMatches(key, 'Words', projected.sourceRecord);
    expect(drafts.readDraft(key)).toBeNull();
  });

  it('discovers only the exact owner, document and aggregate', () => {
    for (const [owner, document, aggregate] of [['a', 'one', 'note'], ['ab', 'one', 'note'], ['a', 'two', 'note'], ['a', 'one', 'conflict:note']]) {
      drafts.saveDraft(drafts.draftKey(owner, document, aggregate, 'opening'), `${owner}/${document}/${aggregate}`);
    }
    expect(drafts.findDraftCopies<string>('a', 'one', 'note').map(copy => copy.value)).toEqual(['a/one/note']);
    drafts.clearDraftsForOwner('a');
    expect(drafts.listDraftKeys()).toEqual([drafts.draftKey('ab', 'one', 'note', 'opening')]);
  });

  it('retires only the matching payload at the named opening', () => {
    const first = drafts.draftKey('owner', 'note', 'note', 'first');
    const second = drafts.draftKey('owner', 'note', 'note', 'second');
    drafts.saveDraft(first, 'First'); drafts.saveDraft(second, 'Second');
    drafts.clearDraftIfMatches(first, 'Old first');
    expect(drafts.readDraft(first)?.value).toBe('First');
    drafts.clearDraftIfMatches(first, 'First');
    expect(drafts.readDraft(first)).toBeNull();
    expect(drafts.readDraft(second)?.value).toBe('Second');
  });

  it('keeps a refused scoped copy visible only to its owner and never evicts another copy', () => {
    const first = drafts.draftKey('owner', 'note', 'note', 'first');
    const second = drafts.draftKey('owner', 'note', 'note', 'second');
    drafts.saveDraft(second, 'Only other copy');
    const write = Storage.prototype.setItem;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
      if (key === first) throw new DOMException('Full', 'QuotaExceededError');
      write.call(this, key, value);
    });
    expect(drafts.saveDraft(first, 'Refused words')).toBe(false);
    expect(drafts.isDraftStorageRefusedFor('owner')).toBe(true);
    expect(drafts.isDraftStorageRefusedFor('other')).toBe(false);
    expect(drafts.readDraft(second)?.value).toBe('Only other copy');
    drafts.clearDraftIfMatches(first, 'Refused words');
    expect(drafts.isDraftStorageRefusedFor('owner')).toBe(false);
  });

  it('carries exact precreate capture ownership to a scoped resource copy', () => {
    const source = drafts.draftKey('owner', 'new~resource', 'note');
    const target = drafts.draftKey('owner', 'resource', 'note', 'opening');
    drafts.saveDraft(source, 'Submitted words', 'resource', true);
    const token = drafts.readDraft(source)?.captureToken;
    drafts.moveDraft(source, target, 'resource');
    expect(drafts.readDraft(source)).toBeNull();
    expect(drafts.readDraft(target)?.captureToken).toBe(token);
    drafts.saveDraft(target, 'Submitted words', undefined, true);
    expect(drafts.readDraft(target)?.captureToken).toBe(token);
    drafts.saveDraft(target, 'Newer words', undefined, true);
    expect(drafts.readDraft(target)?.captureToken).not.toBe(token);
  });
});
