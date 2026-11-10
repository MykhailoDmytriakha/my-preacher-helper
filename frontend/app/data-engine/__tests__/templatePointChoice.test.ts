import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';
import { editorIdentity } from '../editorIdentity';
import { projectSavedChoiceDependents, recoverManualChoiceCopy } from '../manualChoice';
import { ordinaryAnswerChoice, ordinaryStoredChoice } from '../ordinaryAnswerChoice';
import { captureOutlinePointPlacement } from '../outlinePointPlacement';
import { diffFields } from '../protocol';
import { planDataCommand } from '../serverRelations';
import { DataSession } from '../session';
import { submittedWorkCheckpoint } from '../submittedWork';

import type { CommitRequest } from '../commits';
import type { EditorRecord } from '../controller';
import type { DocumentData, ResourceSnapshot } from '../types';
import type { SermonOutline } from '@/models/models';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'planTemplates', id: 'template' };
const metadata = { protocol: 1 as const, generation: 'template-generation', revision: 1, deleted: false };
const point = { id: 'a', text: 'Opening words' };
const other = { id: 'b', text: 'Separate point' };
const opening = { introduction: [], main: [point, other], conclusion: [] };
const firstMove = { introduction: [point], main: [other], conclusion: [] };
const storedMove = { introduction: [], main: [other], conclusion: [point] };
const time = { earliestMs: 1_800_000_000_010, latestMs: 1_800_000_000_014 };
const value = (structure: SermonOutline): DocumentData => ({ userId: 'owner', name: 'Template', createdAt: '2026-11-09', updatedAt: '2026-11-09', structure: structure as unknown as DocumentData });
const snapshot = (structure: SermonOutline, revision = 1): ResourceSnapshot => ({ resource, value: value(structure), metadata: { ...metadata, revision } });
const request = (id: string, structure: SermonOutline, predecessor: string | null = null): CommitRequest => ({
  id, owner: 'owner', editorId: editorIdentity('tab', resource, 'template-structure', 'one'), editGeneration: predecessor ? 2 : 1,
  predecessor, baseline: snapshot(opening), working: snapshot(opening), value: value(structure), intended: value(structure),
  initialized: false, command: null, submitted: null, state: 'cancelled', sequence: 0, revision: 0, result: null, unfinalized: [],
  ...(predecessor && { retainedAfterChoice: true as const }),
});

it.each([false, true])('retains words from an unsigned old Save on the saved point (independent addition: %s)', add => {
  const additions = add ? [{ id: 'new-point', text: 'An independent addition' }] : [];
  const edited = { ...firstMove, introduction: [{ ...point, text: 'Offline words' }, ...additions] };
  const first = request('legacy', edited);
  const refused: CommitRequest = { ...first, initialized: true, state: 'refused', submitted: first.value,
    command: { protocol: 1, kind: 'update', owner: first.owner, operationId: first.id,
      resource, generation: metadata.generation, dependsOn: [], changes: diffFields(first.baseline.value!, first.value!) },
    result: { kind: 'refused', operationId: first.id, code: 'template-point-placement-needs-review' },
  };
  const choice = ordinaryAnswerChoice(refused, [refused])!;
  const stored = snapshot(storedMove, 3);
  const [copy] = ordinaryStoredChoice('owner', [choice], [{ ...refused, state: 'cancelled', revision: 1 }], stored).editorRecords;
  expect(copy).toBeDefined();
  expect(recoverManualChoiceCopy(copy, stored).checkpoint).toMatchObject({
    draft: value({ ...storedMove, introduction: additions, conclusion: [{ ...point, text: 'Offline words' }] }), conflicts: [],
  });
  const competing = snapshot({ ...storedMove, conclusion: [{ ...point, text: 'Other text' }] }, 4);
  expect(recoverManualChoiceCopy(copy, competing).checkpoint).toMatchObject({
    remoteCandidate: competing, conflicts: [{ path: ['structure', 'conclusion', 'id:a', 'text'] }],
  });
});

it.each(['existing parent', 'new parent', 'promoted'] as const)('recovers a child’s words in its saved place after refusing an old move (%s)', destination => {
  const newParent = destination === 'new parent';
  const child = { id: 'child', text: 'Opening child words', position: 0 };
  const parent = newParent ? { id: 'new-parent', text: 'New parent' } : other;
  const withChild = { ...point, subPoints: [child] };
  const initial = { ...opening, main: [withChild, other] };
  const legacy = { ...firstMove, introduction: [{ ...point, subPoints: [{ ...child, text: 'Phone child words' }] }] };
  const withSavedWords = (text: string) => ({ ...storedMove, main: destination === 'promoted' ? [other, { id: child.id, text }]
    : [...(newParent ? [other] : []), { ...parent, subPoints: [{ ...child, text }] }] });
  const saved = withSavedWords(child.text);
  const oldRequest = request('legacy-child', legacy);
  const refused: CommitRequest = { ...oldRequest, baseline: snapshot(initial), working: snapshot(initial), initialized: true,
    state: 'refused', submitted: oldRequest.value,
    command: { protocol: 1, kind: 'update', owner: oldRequest.owner, operationId: oldRequest.id,
      resource, generation: metadata.generation, dependsOn: [], changes: diffFields(value(initial), oldRequest.value!) },
    result: { kind: 'refused', operationId: oldRequest.id, code: 'template-point-placement-needs-review' },
  };
  const choice = ordinaryAnswerChoice(refused, [refused])!;
  const stored = snapshot(saved, 3);
  const [copy] = ordinaryStoredChoice('owner', [choice], [{ ...refused, state: 'cancelled', revision: 1 }], stored).editorRecords;
  expect(copy).toBeDefined();
  const expected = withSavedWords('Phone child words');
  expect(recoverManualChoiceCopy(copy, stored).checkpoint).toMatchObject({ draft: value(expected), conflicts: [] });
});

it('captures the same recovered move once when two Saves start before the first completes', async () => {
  const h = documentEngineHarness(snapshot(opening), { apply: async (command, stored) => (await planDataCommand(command, stored,
    { get: async () => stored, list: async () => [stored] })).result });
  const browser = h.createBrowser();
  try {
    const engine = browser.engine;
    engine.setOnline(false);
    engine.setOwner('owner');
    const editorId = browser.editorId(resource);
    const session = new DataSession(snapshot(opening));
    const move = captureOutlinePointPlacement(opening, firstMove, point.id, metadata.generation, 1, time)!;
    session.stageOutlinePointPlacementRetry(move, value(firstMove));
    const edited = { ...firstMove, main: [{ ...other, text: 'Typing after recovery' }] };
    session.edit(value(edited));
    await h.checkpoints.put({ owner: 'owner', editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] });
    const editor = await engine.openEditor(resource, editorId);
    const persistedGenerations: number[] = [];
    h.storage.holdCompletionAfterCommit = (rows, mode) => {
      const stored = rows.get(JSON.stringify(['checkpoint', 'owner', editorId])) as EditorRecord | undefined;
      if (mode === 'readwrite' && stored && Object.keys(stored.checkpoint.pending).length) {
        persistedGenerations.push(stored.checkpoint.editGeneration);
      }
      return false;
    };
    await Promise.all([editor.save(), editor.save()]);
    h.storage.holdCompletionAfterCommit = undefined;
    const captures = await h.commits.list('owner');
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ outlinePointPlacement: move, value: value(firstMove) });
    expect(editor.getState().checkpoint.draft).toEqual(value(edited));
    expect(new Set(persistedGenerations)).toEqual(new Set([editor.getState().checkpoint.editGeneration]));
    expect((await h.checkpoints.read('owner', editorId))?.checkpoint).toMatchObject({
      draft: value(edited), editGeneration: editor.getState().checkpoint.editGeneration,
    });
    await editor.save();
    engine.setOnline(true);
    await engine.retry(); await settleEngine();
    expect(h.server.value?.structure).toEqual(edited);
  } finally { browser.dispose(); }
});

it('keeps a second gesture with its original time and an independent word Save after choosing the first', () => {
  const secondMove = { introduction: [point, other], main: [], conclusion: [] };
  const words = { ...secondMove, introduction: [point, { ...other, text: 'Later draft words' }] };
  const first = request('first', firstMove);
  const second = request('second', secondMove, first.id);
  first.outlinePointPlacement = captureOutlinePointPlacement(opening, firstMove, point.id, metadata.generation, 1, time);
  second.outlinePointPlacement = captureOutlinePointPlacement(firstMove, secondMove, other.id, metadata.generation, 1, time);
  const stored = snapshot({ ...storedMove, introduction: [{ id: 'anchor', text: 'New anchor' }], main: [] }, 3);
  // The chosen side still has the second move’s anchor, even though the first move was retired.
  const chosen = snapshot({ ...firstMove, main: [{ ...other, text: 'Other device words' }] }, 3);
  const [position, text] = projectSavedChoiceDependents('owner', first, chosen, chosen.value,
    [first, second, request('words', words, second.id)]);
  expect(position.retainedManualChoice?.outlinePointPlacement).toEqual(second.outlinePointPlacement);
  const recovered = recoverManualChoiceCopy(position, chosen).checkpoint;
  expect(recovered.outlinePointPlacementRetry?.placement).toMatchObject({ pointId: other.id, time, observedRevision: 1 });
  expect(recovered.draft).toEqual(value({ ...secondMove, introduction: [point, { ...other, text: 'Other device words' }] }));
  const alreadyThere = snapshot(secondMove, 4);
  expect(recoverManualChoiceCopy(position, alreadyThere).checkpoint).toMatchObject({
    draft: alreadyThere.value, dirty: true, outlinePointPlacementRetry: { placement: { pointId: other.id, time, observedRevision: 1 } },
  });
  expect(recoverManualChoiceCopy(text, chosen).checkpoint.conflicts).toHaveLength(1);
  expect(() => recoverManualChoiceCopy(position, { ...stored, metadata: { ...metadata, revision: 4 } })).toThrow(/position is unavailable/);
});


it.each(['local', 'remote'] as const)('keeps unqueued text independent from the %s position choice', async side => {
  const h = documentEngineHarness(snapshot(opening), { apply: async (command, stored) => (await planDataCommand(command, stored,
    { get: async () => stored, list: async () => [stored] })).result });
  const browser = h.createBrowser();
  try {
    const engine = browser.engine;
    engine.setOnline(false);
    engine.setOwner('owner');
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    const move = captureOutlinePointPlacement(opening, firstMove, point.id, metadata.generation, 1, null)!;
    await editor.commit(() => value(firstMove), { kind: 'outline-point-placement', move });
    const edited = { ...other, text: 'Unqueued words' };
    await editor.edit(value({ ...firstMove, main: [edited] }));
    h.silentRemote(value(storedMove));
    engine.setOnline(true);
    await engine.retry();
    await settleEngine();
    expect(editor.getState().result?.kind).toBe('conflict');
    if (side === 'local') await editor.keepLocal();
    else await editor.acceptRemote();
    await engine.retry();
    await settleEngine();
    if (side === 'local') {
      expect(h.server.value?.structure).toEqual(firstMove);
      const drafts = await h.checkpoints.listManualChoiceCopies!('owner', resource);
      expect(drafts).toHaveLength(1);
      expect(recoverManualChoiceCopy(drafts[0].record, h.server).checkpoint.draft?.structure).toEqual({ ...firstMove, main: [edited] });
    } else {
      expect(h.server.value?.structure).toEqual(storedMove);
      expect(editor.getState().checkpoint.draft?.structure).toEqual({ ...storedMove, main: [edited] });
    }
  } finally { browser.dispose(); }
});


it.each([false, true])('retains an exact move and accepted remote words after an earlier Save (reopen: %s)', reopen => {
  const firstWords = { ...opening, main: [point, { ...other, text: 'My first words' }] };
  const moved = { ...firstMove, main: firstWords.main.slice(1) };
  const first = { ...request('first', firstWords), state: 'queued' as const };
  const second = { ...request('second', moved, first.id), state: 'queued' as const,
    outlinePointPlacement: captureOutlinePointPlacement(firstWords, moved, point.id, metadata.generation, 1, time) };
  const session = reopen ? DataSession.restore(submittedWorkCheckpoint('owner', resource, [first, second])!) : new DataSession(snapshot(opening));
  if (!reopen) for (const queued of [first, second]) {
    session.edit(queued.value);
    session.registerCommit(queued.id, session.checkpoint().editGeneration, queued.value, undefined, queued);
  }
  const acceptedPoint = { ...point, text: 'New remote words' };
  const accepted = snapshot({ ...firstWords, main: [acceptedPoint, firstWords.main[1]] }, 2);
  session.applyCommit({ ...first, state: 'acknowledged', result: { kind: 'acknowledged', operationId: first.id, snapshot: accepted } });
  expect(session.checkpoint()).toMatchObject({ draft: value({ ...moved, introduction: [acceptedPoint] }), conflicts: [] });
});

it('keeps a word edit typed before the first Save of a recovered move in a new generation', () => {
  const session = new DataSession(snapshot(opening));
  const move = captureOutlinePointPlacement(opening, firstMove, point.id, metadata.generation, 1, time)!;
  session.stageOutlinePointPlacementRetry(move, value(firstMove));
  const edited = value({ ...firstMove, main: [{ ...other, text: 'Typing after recovery' }] });
  session.edit(edited);
  const scoped = { ...request('retry', firstMove), state: 'queued' as const, outlinePointPlacement: move,
    editGeneration: session.checkpoint().editGeneration };
  session.applyCommit(scoped);
  expect(session.checkpoint().editGeneration).toBeGreaterThan(scoped.editGeneration);
  expect(session.checkpoint().draft).toEqual(edited);
});

it.each(['point', 'anchor'] as const)('can move after this editor added its %s and received the exact add receipt', async added => {
  const anchor = { id: 'anchor', text: 'New anchor' };
  const initial = added === 'point' ? { ...opening, main: [other] } : opening;
  const before = added === 'point' ? opening : { ...opening, introduction: [anchor] };
  const moved = { ...firstMove, introduction: [...before.introduction, point] };
  const h = documentEngineHarness(snapshot(initial), { apply: async (command, stored) => (await planDataCommand(command, stored,
    { get: async () => stored, list: async () => [stored] })).result });
  const browser = h.createBrowser();
  try {
    const engine = browser.engine;
    engine.setOnline(false);
    engine.setOwner('owner');
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    await editor.edit(value(before));
    const move = captureOutlinePointPlacement(before, moved, point.id, metadata.generation, 1, time)!;
    await editor.commit(() => value(moved), { kind: 'outline-point-placement', move });
    engine.setOnline(true);
    await engine.retry(); await settleEngine();
    expect(h.transport.send).toHaveBeenCalledWith(expect.objectContaining({ outlinePointPlacement: expect.objectContaining({ observedRevision: 2, time }) }));
    expect(h.server.value?.structure).toEqual(moved);
  } finally { browser.dispose(); }
});
