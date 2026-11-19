import { DRAFT_CAPTURE_PREFIX, prepareDraftCapture, prepareNoteDraftCapture, reconcileCapturedDrafts, type CapturedDraftWrite, type DraftCapturePort } from '../draftCaptureRecovery.client';
import { draftKey, moveDraft, readDraft, saveDraft, subscribeDraftCapture } from '../durableDraft';
import { planTransferCaptureScope } from '../planDraftCapture.client';

const owner = 'owner', resource = { collection: 'studyNotes', id: 'note' };
const key = draftKey(owner, resource.id, 'note');
const words = { title: 'Title', content: 'Captured words', tags: [], scriptureRefs: [], type: 'note' };
function setup() {
  saveDraft(key, words, undefined, true);
  const token = readDraft(key)!.captureToken!;
  const scope = prepareDraftCapture(key, words, resource)!;
  const captured: CapturedDraftWrite = { owner, resource, scope, requestId: 'request', value: { userId: owner, ...words } };
  const port: DraftCapturePort = { listWriteCaptures: jest.fn(async () => [captured]),
    releaseWriteCapture: jest.fn(async () => undefined), subscribeSavedWork: jest.fn(() => () => undefined) };
  return { scope, token, captured, port };
}
beforeEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

describe('canonical plan text transfer recovery', () => {
  const sermon = { collection: 'sermons', id: 'plan' };
  const parent = draftKey(owner, sermon.id, 'plan:point', 'opening');
  const child = draftKey(owner, sermon.id, 'plan:child', 'opening');
  const independent = draftKey(owner, sermon.id, 'plan:child', 'other-opening');
  const transfer = { pointId: 'point', subPointId: 'child' };
  const value = {
    userId: owner, outline: { introduction: [], main: [{ id: 'point', subPoints: [] }], conclusion: [] },
    planText: { point: 'Parent words.\n\nChild words.', child: '' },
  };

  function planCapture(overrides: Partial<CapturedDraftWrite> = {}) {
    saveDraft(parent, 'Parent words.', undefined, true);
    saveDraft(child, 'Child words.', undefined, true);
    saveDraft(independent, 'Child words.', undefined, true);
    const scope = planTransferCaptureScope('point', 'child', [parent, child].map(key => ({ key, proof: readDraft(key)!.captureToken! })))!;
    const captured = { owner, resource: sermon, requestId: 'transfer', value, acceptedValue: value, planTransfer: transfer,
      scope, state: 'acknowledged', ...overrides };
    return { captured, port: { listWriteCaptures: async () => [captured],
      releaseWriteCapture: jest.fn(async () => undefined), subscribeSavedWork: () => () => undefined } satisfies DraftCapturePort };
  }

  it('retires the carried parent and child but keeps an independent copy of equal words', async () => {
    const { captured, port } = planCapture();
    await reconcileCapturedDrafts(owner, port);
    expect(readDraft(parent)).toBeNull();
    expect(readDraft(child)).toBeNull();
    expect(readDraft(independent)?.value).toBe('Child words.');
    expect(port.releaseWriteCapture).toHaveBeenCalledWith(captured.scope, 'transfer');
  });

  it('keeps a later physical copy at the same address', async () => {
    const { port } = planCapture();
    saveDraft(child, 'Later unsent child words.', undefined, true);
    await reconcileCapturedDrafts(owner, port);
    expect(readDraft(parent)).toBeNull();
    expect(readDraft(child)?.value).toBe('Later unsent child words.');
    expect(port.releaseWriteCapture).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: 'queued', acceptedValue: undefined },
    { state: 'conflict', acceptedValue: undefined },
    { planTransfer: { pointId: 'other', subPointId: 'child' } },
  ])('retains the backups when the accepted transfer cannot be proved (%j)', async overrides => {
    const { port } = planCapture(overrides);
    await reconcileCapturedDrafts(owner, port);
    expect(readDraft(parent)?.value).toBe('Parent words.');
    expect(readDraft(child)?.value).toBe('Child words.');
    expect(port.releaseWriteCapture).not.toHaveBeenCalled();
  });

  it('keeps private words and releases its hold if the terminal snapshot no longer proves the transfer', async () => {
    const { port } = planCapture({ acceptedValue: { ...value, planText: { point: 'Different stored words.' } } });
    await reconcileCapturedDrafts(owner, port);
    expect(readDraft(parent)?.value).toBe('Parent words.');
    expect(readDraft(child)?.value).toBe('Child words.');
    expect(port.releaseWriteCapture).toHaveBeenCalledTimes(1);
  });
});

describe('canonical note draft capture recovery', () => {
  it.each([false, true])('retires only its scoped copy without depending on a legacy slot: malformedLegacy=%s', async malformed => {
    const first = draftKey(owner, resource.id, 'note', 'opening-a');
    const second = draftKey(owner, resource.id, 'note', 'opening-b');
    saveDraft(first, words, undefined, true);
    saveDraft(second, { ...words, content: 'Other unfinished words' });
    const other = localStorage.getItem(second);
    const legacy = malformed ? '{' : JSON.stringify({ value: { ...words, content: 'Older unbound words' }, savedAt: 1 });
    localStorage.setItem(key, legacy);
    const scope = prepareDraftCapture(first, words, resource)!;
    const port: DraftCapturePort = { listWriteCaptures: async () => [{ owner, resource, scope, requestId: 'scoped', value: words }],
      releaseWriteCapture: jest.fn(async () => undefined), subscribeSavedWork: () => () => undefined };
    await reconcileCapturedDrafts(owner, port);
    expect(readDraft(first)).toBeNull();
    expect(localStorage.getItem(second)).toBe(other);
    expect(localStorage.getItem(key)).toBe(legacy);
    expect(port.releaseWriteCapture).toHaveBeenCalledWith(scope, 'scoped');
  });
  it('retires a bound copy after its capturing page is gone, then releases only that request', async () => {
    const { scope, port } = setup(); const notified = jest.fn(); const stop = subscribeDraftCapture(notified);
    try {
      await reconcileCapturedDrafts(owner, port);
      expect(readDraft(key)).toBeNull();
      expect(port.listWriteCaptures).toHaveBeenCalledWith(DRAFT_CAPTURE_PREFIX);
      expect(port.releaseWriteCapture).toHaveBeenCalledWith(scope, 'request');
      expect(notified).toHaveBeenCalledWith({ key, value: words });
    } finally { stop(); }
  });
  it('never interprets an absent request as acceptance', async () => {
    const { port } = setup(); jest.mocked(port.listWriteCaptures).mockResolvedValue([]);
    const before = localStorage.getItem(key); await reconcileCapturedDrafts(owner, port);
    expect(localStorage.getItem(key)).toBe(before); expect(port.releaseWriteCapture).not.toHaveBeenCalled();
  });
  it('preserves proof through a same-value flush and drops it for later words', async () => {
    const { scope, token, port } = setup(); saveDraft(key, { ...words }); expect(readDraft(key)?.captureToken).toBe(token);
    saveDraft(key, { ...words, content: 'Later unsent words' }); const before = localStorage.getItem(key);
    expect(readDraft(key)?.captureToken).toBeUndefined(); await reconcileCapturedDrafts(owner, port);
    expect(localStorage.getItem(key)).toBe(before); expect(port.releaseWriteCapture).toHaveBeenCalledWith(scope, 'request');
  });
  it('releases an orphan hold after a crash between local removal and release', async () => {
    const { scope, port } = setup(); localStorage.removeItem(key); await reconcileCapturedDrafts(owner, port);
    expect(port.releaseWriteCapture).toHaveBeenCalledWith(scope, 'request');
  });
  it('releases its orphan hold despite an unrelated malformed draft', async () => {
    const { scope, port } = setup(); localStorage.removeItem(key);
    const unrelated = draftKey(owner, 'another', 'note'); localStorage.setItem(unrelated, '{');
    await reconcileCapturedDrafts(owner, port);
    expect(port.releaseWriteCapture).toHaveBeenCalledWith(scope, 'request');
    expect(localStorage.getItem(unrelated)).toBe('{');
  });
  it.each(['read', 'parse'] as const)('defers cleanup and release on an incomplete relevant %s', async failure => {
    const { port } = setup();
    if (failure === 'parse') localStorage.setItem(key, '{');
    const before = localStorage.getItem(key);
    if (failure === 'read') jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
    await reconcileCapturedDrafts(owner, port); expect(port.releaseWriteCapture).not.toHaveBeenCalled();
    jest.restoreAllMocks(); expect(localStorage.getItem(key)).toBe(before);
  });
  it.each(['source', 'target'] as const)('defers a creation handoff while its %s copy is malformed', async invalid => {
    const source = draftKey(owner, 'new~note', 'note'); saveDraft(source, words, resource.id, true);
    const scope = prepareDraftCapture(source, words, resource)!;
    localStorage.setItem(key, localStorage.getItem(source)!);
    localStorage.setItem(invalid === 'source' ? source : key, '{');
    const sourceBefore = localStorage.getItem(source), targetBefore = localStorage.getItem(key);
    const port: DraftCapturePort = { listWriteCaptures: async () => [{ owner, resource, scope, requestId: 'create', value: words }],
      releaseWriteCapture: jest.fn(async () => undefined), subscribeSavedWork: () => () => undefined };
    await reconcileCapturedDrafts(owner, port);
    expect(localStorage.getItem(source)).toBe(sourceBefore); expect(localStorage.getItem(key)).toBe(targetBefore);
    expect(port.releaseWriteCapture).not.toHaveBeenCalled();
  });
  it('keeps the copy and hold when removal fails', async () => {
    const { port } = setup(); const before = localStorage.getItem(key);
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Refused'); });
    await reconcileCapturedDrafts(owner, port); expect(localStorage.getItem(key)).toBe(before);
    expect(port.releaseWriteCapture).not.toHaveBeenCalled();
  });
  it('never grants ownership when the ordinary capture backup is refused', () => {
    saveDraft(key, words); const before = localStorage.getItem(key);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    expect(prepareNoteDraftCapture(owner, resource.id, words)).toBeUndefined(); expect(localStorage.getItem(key)).toBe(before);
  });
  it('preserves unknown words when an old bundle stripped their binding', async () => {
    const { scope, port } = setup(); localStorage.setItem(key, JSON.stringify({ value: words, savedAt: 1 }));
    const before = localStorage.getItem(key); await reconcileCapturedDrafts(owner, port);
    expect(localStorage.getItem(key)).toBe(before); expect(port.releaseWriteCapture).toHaveBeenCalledWith(scope, 'request');
  });
  it.each(['owner', 'resource', 'scope', 'empty'] as const)('rejects a mismatched %s capture', async mismatch => {
    const { captured, port } = setup(); const before = localStorage.getItem(key);
    if (mismatch === 'owner') captured.owner = 'another-owner';
    if (mismatch === 'resource') captured.resource = { ...resource, id: 'another-note' };
    if (mismatch === 'scope') captured.scope = 'membership:v1:other';
    if (mismatch === 'empty') captured.value = null;
    await reconcileCapturedDrafts(owner, port); expect(localStorage.getItem(key)).toBe(before);
    expect(port.releaseWriteCapture).not.toHaveBeenCalled();
  });
  it('fences an owner change while the canonical read waits', async () => {
    const { port, captured } = setup(); const before = localStorage.getItem(key);
    let release!: (values: CapturedDraftWrite[]) => void;
    jest.mocked(port.listWriteCaptures).mockReturnValue(new Promise(resolve => { release = resolve; }));
    let active = true; const pending = reconcileCapturedDrafts(owner, port, () => active);
    active = false; release([captured]); await pending;
    expect(localStorage.getItem(key)).toBe(before); expect(port.releaseWriteCapture).not.toHaveBeenCalled();
  });
  it.each([[false, undefined], [true, undefined], [false, 'opening'], [true, 'opening']] as const)('follows a reserved creation before or after adoption (moved=%s,writer=%s)', async (moved, writerId) => {
    const source = draftKey(owner, 'new~note', 'note', writerId); saveDraft(source, words, resource.id, true);
    const destination = draftKey(owner, resource.id, 'note', writerId);
    const scope = prepareDraftCapture(source, words, resource)!;
    if (moved) moveDraft(source, destination, resource.id);
    const port: DraftCapturePort = { listWriteCaptures: async () => [{ owner, resource, scope, requestId: 'create', value: words }],
      releaseWriteCapture: jest.fn(async () => undefined), subscribeSavedWork: () => () => undefined };
    await reconcileCapturedDrafts(owner, port); expect(readDraft(source)).toBeNull(); expect(readDraft(destination)).toBeNull();
    expect(port.releaseWriteCapture).toHaveBeenCalledWith(scope, 'create');
  });
  it('retains capture ownership when a created note sheds its precreate tag at its actual address', async () => {
    const source = draftKey(owner, 'new~note', 'note'); saveDraft(source, words, resource.id, true);
    const token = readDraft(source)!.captureToken!;
    prepareDraftCapture(source, words, resource);
    moveDraft(source, key, resource.id);
    saveDraft(key, words);
    expect(readDraft(key)?.creationTargetId).toBeUndefined();
    expect(readDraft(key)?.captureToken).toBe(token);
  });
  it.each([{}, 7, null, []])('ignores malformed optional identity %j without breaking typing', captureToken => {
    localStorage.setItem(key, JSON.stringify({ value: words, savedAt: 1, captureToken }));
    expect(() => prepareDraftCapture(key, words, resource)).not.toThrow();
    expect(() => saveDraft(key, { ...words, content: 'Fresh typing' })).not.toThrow();
    expect(readDraft(key)?.value).toEqual({ ...words, content: 'Fresh typing' });
    expect(readDraft(key)?.captureToken).toBeUndefined();
  });
  it('never overwrites later words arriving during any metadata preparation read', () => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    const later = { ...words, content: 'Later words from the other tab' };
    for (let trigger = 1; trigger <= 5; trigger += 1) {
      localStorage.clear(); saveDraft(key, words, undefined, true);
      let reads = 0, inserted = false;
      const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, name: string) {
        const raw = get.call(this, name);
        if (name === key && ++reads === trigger) {
          inserted = true;
          set.call(this, key, JSON.stringify({ value: later, savedAt: 2 }));
        }
        return raw;
      });
      try { prepareDraftCapture(key, words, resource); } finally { spy.mockRestore(); }
      expect(readDraft(key)?.value).toEqual(inserted ? later : words);
    }
  });
  it('does not bind different words or retain proof across a creation change', () => {
    setup();
    expect(prepareDraftCapture(key, { ...words, content: 'Other words' }, resource)).toBeUndefined();
    saveDraft(key, words, 'another-creation'); expect(readDraft(key)?.captureToken).toBeUndefined();
  });
});

describe('the immediate note backup keeps what its words are sent against', () => {
  it('records the base beside the submitted words, and the capture still binds the words', () => {
    const writer = draftKey(owner, resource.id, 'note', 'opening');
    const base = { ...words, content: 'Opened words' };
    const scope = prepareNoteDraftCapture(owner, resource.id, words, 'opening', 7, base);
    expect(scope).toBeDefined();
    expect(readDraft(writer)).toEqual(expect.objectContaining({ value: words, base, editedAt: 7, captureToken: expect.any(String) }));
  });
});
