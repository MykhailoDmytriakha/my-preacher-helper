import { membershipEngineHarness } from '@test-utils/membershipEngineHarness';
import { settleEngine } from '@test-utils/documentEngineHarness';
import { analysisMarkdown, EMPTY_ANALYSIS, passageWords, storedAnalysis } from '@/utils/passageAnalysis';
import rstEphesians from '../../../public/bible-text/rst/v1/ephesians.json';

import type { CommitRequest } from '@/data-engine/commits';
import type { BookText } from '@/utils/bibleText';
import type { DocumentData, ResourceRef, ResourceSnapshot } from '@/data-engine/types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const text = rstEphesians as BookText;
const sourceResource: ResourceRef = { collection: 'studyNotes', id: 'analysis-source' };
const recipientResource: ResourceRef = { collection: 'studyNotes', id: 'analysis-recipient' };
const verseRef = (fromVerse: number, toVerse = fromVerse, id = `eph-1-${fromVerse}-${toVerse}`) => ({
  id, bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse, toVerse,
});
const words = (fromVerse: number, toVerse = fromVerse) => passageWords(text, { chapter: 1, fromVerse, toChapter: 1, toVerse });
const valueFor = (fromVerse: number, toVerse = fromVerse, title = `Ephesians ${fromVerse}-${toVerse}`): DocumentData => {
  const passage = words(fromVerse, toVerse);
  return { userId: owner, type: 'analysis', title, content: analysisMarkdown(passage, EMPTY_ANALYSIS), tags: [], isDraft: false,
    createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z', scriptureRefs: [verseRef(fromVerse, toVerse)],
    analysis: storedAnalysis(EMPTY_ANALYSIS, 'rst', passage.length) as unknown as DocumentData };
};
const source = (): ResourceSnapshot => ({ resource: sourceResource, value: valueFor(1, 2, 'Original Ephesians analysis'),
  metadata: { protocol: 1, generation: 'analysis-source-generation', revision: 1, deleted: false } });
const unseen = (): ResourceSnapshot => ({ resource: { collection: 'studyNotes', id: 'unseen-analysis' }, value: valueFor(1, 1, 'Canonical unseen Ephesians analysis'),
  metadata: { protocol: 1, generation: 'unseen-generation', revision: 1, deleted: false } });
const byId = (rows: readonly CommitRequest[], id: string) =>
  rows.find(request => request.baseline.resource.id === id);

describe('analysis uniqueness through saved DataEngine work', () => {
  it('retains and explicitly discards a refused offline reshape after restart without changing canonical work', async () => {
    const initial = source(), canonical = unseen();
    const h = membershipEngineHarness([initial]);
    let browser = h.createBrowser();
    let engine = browser.engine;
    try {
    engine.setOnline(false); engine.setOwner(owner);
    const sourceNext = valueFor(1, 1, 'Original Ephesians analysis');
    const recipientNext = valueFor(2, 2, 'Moved Ephesians words');
    const sourceBefore = JSON.parse(JSON.stringify(initial.value!)) as DocumentData;
    await engine.reshapeStudyAnalysis([
      { resource: sourceResource, expected: sourceBefore, value: sourceNext },
      { resource: recipientResource, expected: null, value: recipientNext },
    ]);
    const savedBeforeDelivery = await h.commits.list(owner);
    const action = savedBeforeDelivery.find(request => request.atomic?.kind === 'analysis-reshape' && request.id === request.atomic.id)!;
    expect(action).toBeDefined();
    expect(action.atomic?.participants).toHaveLength(2);
    expect(h.read(recipientResource).value).toBeNull();
    expect(h.read({ collection: 'studyNotes', id: 'unseen-analysis' }).value).toBeNull();

    // Simulate another device creating the exact source passage after this browser's cached read.
    h.replace(canonical);
    expect(h.read({ collection: 'studyNotes', id: 'unseen-analysis' })).toEqual(canonical);
    expect(h.read(sourceResource)).toEqual(initial);
    engine.setOnline(true); await engine.retry(); await settleEngine();

    const firstSend = jest.mocked(h.transport.send);
    expect(firstSend).toHaveBeenCalledTimes(1);
    const firstResult = await Promise.resolve(firstSend.mock.results[0].value);
    const delivery = (await engine.listAnalysisReshapes()).find(candidate => candidate.id === action.id);
    const sourceAfterDelivery = h.read(sourceResource), unseenAfterDelivery = h.read({ collection: 'studyNotes', id: 'unseen-analysis' });
    const recipientAfterDelivery = h.read(recipientResource);
    expect({ result: firstResult.kind === 'refused' ? { kind: firstResult.kind, code: firstResult.code } : { kind: firstResult.kind },
      delivery: delivery?.delivery ?? null, source: sourceAfterDelivery, unseen: unseenAfterDelivery, recipient: recipientAfterDelivery.value })
      .toEqual({ result: { kind: 'refused', code: 'analysis-exists' },
        delivery: { phase: 'refused', canDiscard: true, code: 'analysis-exists' }, source: initial, unseen: canonical, recipient: null });
    expect(h.read(sourceResource)).toEqual(initial);
    expect(h.read({ collection: 'studyNotes', id: 'unseen-analysis' })).toEqual(canonical);
    expect(h.read(recipientResource).value).toBeNull();
    const refused = await h.commits.list(owner);
    expect(byId(refused, 'analysis-source')).toMatchObject({ state: 'refused', result: { kind: 'refused', code: 'analysis-exists' } });
    expect(refused.find(request => request.atomic?.id === action.id && request.baseline.resource.id === sourceResource.id)?.value).toEqual(sourceNext);
    expect(refused.find(request => request.atomic?.id === action.id && request.baseline.resource.id === recipientResource.id)?.value).toEqual(recipientNext);
    expect(jest.mocked(h.transport.send).mock.calls).toHaveLength(1);

    browser.dispose();
    browser = h.createBrowser(); engine = browser.engine;
    engine.setOnline(false); engine.setOwner(owner);
    const recovered = await engine.listAnalysisReshapes();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ id: action.id, resource: sourceResource, delivery: { phase: 'refused', canDiscard: true, code: 'analysis-exists' } });
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(jest.mocked(h.transport.send).mock.calls).toHaveLength(1);

    await engine.discardAnalysisReshape(action.id);
    expect(await engine.listAnalysisReshapes()).toEqual([]);
    expect(h.read(sourceResource)).toEqual(initial);
    expect(h.read({ collection: 'studyNotes', id: 'unseen-analysis' })).toEqual(canonical);
    expect(h.read(recipientResource).value).toBeNull();
    const remainingActionRows = (await h.commits.list(owner)).filter(request => request.atomic?.id === action.id);
    expect(remainingActionRows.every(request => request.state === 'cancelled')).toBe(true);
    expect(h.read(sourceResource).value).toEqual(initial.value);
    expect(h.read(sourceResource).value?.content).toContain(words(2)[0].text);
    expect(h.read(sourceResource).value?.scriptureRefs).toEqual(initial.value?.scriptureRefs);
    expect(h.read(sourceResource).value?.analysis).toEqual(initial.value?.analysis);
    expect(jest.mocked(h.transport.send).mock.calls).toHaveLength(1);
    } finally {
      browser.dispose();
    }
  });

  it('retains an ordinary source-only passage update when it targets an unseen exact identity', async () => {
    const initial = source(), canonical = unseen(), h = membershipEngineHarness([initial]);
    const browser = h.createBrowser(), engine = browser.engine;
    let editor: Awaited<ReturnType<typeof engine.openEditor>> | null = null;
    try {
    engine.setOnline(false); engine.setOwner(owner);
    editor = await engine.openEditor(sourceResource, 'ordinary-source-edit');
    const next = valueFor(1, 1, 'Original Ephesians analysis');
    await editor.commit(() => next); await engine.retry(); await settleEngine();
    h.replace(canonical);
    engine.setOnline(true); await engine.retry(); await settleEngine();

    const send = jest.mocked(h.transport.send);
    expect(send).toHaveBeenCalledTimes(1);
    const result = await Promise.resolve(send.mock.results[0].value);
    const requests = await h.commits.list(owner);
    const request = byId(requests, sourceResource.id) ?? null;
    const sourceAfterDelivery = h.read(sourceResource), unseenAfterDelivery = h.read({ collection: 'studyNotes', id: 'unseen-analysis' });
    const draftAfterDelivery = editor.getState().checkpoint.draft;
    expect({ result: result.kind === 'refused' ? { kind: result.kind, code: result.code } : { kind: result.kind },
      request: request ? { state: request.state, result: request.result, value: request.value } : null,
      source: sourceAfterDelivery, unseen: unseenAfterDelivery, draft: draftAfterDelivery })
      .toMatchObject({ result: { kind: 'refused', code: 'analysis-exists' },
        request: { state: 'refused', result: { kind: 'refused', code: 'analysis-exists' }, value: next },
        source: initial, unseen: canonical, draft: next });
    expect(editor.getState().checkpoint.draft).toEqual(next);
    expect(h.read(sourceResource)).toEqual(initial);
    expect(h.read({ collection: 'studyNotes', id: 'unseen-analysis' })).toEqual(canonical);
    expect(jest.mocked(h.transport.send).mock.calls).toHaveLength(1);
    } finally {
      editor?.dispose();
      browser.dispose();
    }
  });
});
