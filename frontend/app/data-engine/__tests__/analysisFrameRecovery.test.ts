import { prepareDomainCommand } from '../domainPolicy';
import { applyCommand, diffFields, mergeDocumentFields } from '../protocol';
import { DataSession } from '../session';
import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';

const resource = { collection: 'studyNotes', id: 'analysis' };
const base: DocumentData = { id: 'analysis', userId: 'owner', type: 'analysis', title: 'Original', tags: [], materialIds: [], isDraft: false,
  content: 'Original words', analysis: { bible: 'rst', words: 12, cuts: [3], links: {}, relations: {} },
  scriptureRefs: [{ id: 'reference', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 2, toVerse: 2 }],
  createdAt: '2026-10-31T10:00:00.000Z', updatedAt: '2026-10-31T10:00:00.000Z' };
const analysis = (value: DocumentData) => value.analysis as DocumentData;
const annotate = (value: DocumentData, key = '1-4'): DocumentData => ({ ...value, analysis: { ...analysis(value),
  relations: { ...(analysis(value).relations as DocumentData), [key]: { dir: 'fwd', color: 'amber' } } } });
const mine = annotate(base);
const expanded: DocumentData = { ...base, content: 'Earlier verse and original words', title: 'Remote title',
  analysis: { ...analysis(base), words: 27, cuts: [15, 18] },
  scriptureRefs: [{ ...(base.scriptureRefs as DocumentData[])[0], fromVerse: 1 }] };
const snapshot = (value: DocumentData, revision = 1): ResourceSnapshot => ({ resource, value,
  metadata: { protocol: 1, generation: 'generation', revision, deleted: false, operationId: `revision-${revision}` } });
const frame = (value: DocumentData) => ({ analysis: value.analysis, content: value.content, scriptureRefs: value.scriptureRefs });
const paths = [['analysis'], ['content'], ['scriptureRefs']];

it('carries all three before/after frame roots in an ordinary positional save', () => {
  const command = prepareDomainCommand('owner', 'offline-edit', snapshot(base), mine).command;
  expect(command.kind).toBe('update');
  if (command.kind !== 'update') throw new Error('Expected ordinary update');
  expect(command.changes.map(change => change.path)).toEqual(expect.arrayContaining(paths));
  expect(command.changes.find(change => change.path[0] === 'scriptureRefs')).toEqual({ path: ['scriptureRefs'],
    before: { exists: true, value: base.scriptureRefs }, after: { exists: true, value: base.scriptureRefs } });
});

it.each(['prepend', 'equal-count-range', 'end-extension'] as const)('retains a whole authored frame on %s and exposes a decision', kind => {
  const remote = kind === 'prepend' ? expanded : { ...expanded,
    analysis: { ...analysis(expanded), words: kind === 'equal-count-range' ? 12 : 18 },
    scriptureRefs: [{ ...(base.scriptureRefs as DocumentData[])[0], fromVerse: kind === 'equal-count-range' ? 3 : 2, toVerse: 3 }] };
  const merged = mergeDocumentFields(base, mine, remote);
  expect(frame(merged.value.value as DocumentData)).toEqual(frame(mine));
  expect((merged.value.value as DocumentData).title).toBe('Remote title');
  expect(merged.conflicts.map(conflict => conflict.path)).toEqual(paths);
});

it('also keeps a local passage reshape whole when a delayed remote annotation arrives', () => {
  const merged = mergeDocumentFields(base, expanded, mine);
  expect(frame(merged.value.value as DocumentData)).toEqual(frame(expanded));
  expect(merged.conflicts.map(conflict => conflict.path)).toEqual(paths);
});

it('takes a one-sided frame change and merges same-basis independent relation maps', () => {
  const rename = { ...base, title: 'Mine' };
  expect(mergeDocumentFields(base, rename, expanded)).toMatchObject({ value: { value: { ...expanded, title: 'Mine' } } });
  const merged = mergeDocumentFields(base, mine, annotate(base, '6-9'));
  expect(merged.conflicts).toEqual([]);
  expect(analysis(merged.value.value as DocumentData).relations).toEqual({ '1-4': { dir: 'fwd', color: 'amber' }, '6-9': { dir: 'fwd', color: 'amber' } });
});

it('normalizes legacy verse-end spelling without inventing a different word basis', () => {
  const legacy = { ...base, scriptureRefs: [{ ...(base.scriptureRefs as DocumentData[])[0], toChapter: 1 }] };
  const merged = mergeDocumentFields(base, mine, { ...legacy, title: 'Remote title' });
  expect(merged.conflicts).toEqual([]);
  expect(analysis(merged.value.value as DocumentData).relations).toEqual(analysis(mine).relations);
});

it('leaves whole-document deletion and ordinary non-analysis notes on existing merge semantics', () => {
  expect(mergeDocumentFields(base, null, expanded).value).toEqual({ exists: false });
  const note = { ...base, type: 'note' };
  expect(mergeDocumentFields(note, { ...note, content: 'Mine' }, { ...note, title: 'Remote' }).conflicts).toEqual([]);
});

it('refuses an old prepared positional command without its source proof instead of guessing', () => {
  const legacy: DataCommand = { protocol: 1, owner: 'owner', operationId: 'legacy', resource, generation: 'generation', dependsOn: [],
    kind: 'update', changes: diffFields(base, mine) };
  expect(applyCommand(legacy, snapshot(expanded, 2))).toMatchObject({ kind: 'refused', code: 'decision-required' });
});

it('retains the raw refused frame across restart and reauthors the complete explicitly chosen local frame', () => {
  const session = new DataSession(snapshot(base)); session.edit(mine);
  const command = session.prepare('offline-edit', 'owner')!;
  const result = applyCommand(command, snapshot(expanded, 2));
  expect(result.kind).toBe('conflict'); session.accept(result);
  const restored = DataSession.restore(session.checkpoint());
  expect(frame(restored.getState().draft!)).toEqual(frame(mine));
  expect(restored.prepare('implicit', 'owner')).toBeNull();
  restored.release(command.operationId); restored.keepLocal();
  expect(frame(restored.getState().draft!)).toEqual(frame(mine));
  const chosen = restored.prepare('explicit-whole-frame', 'owner')!;
  const accepted = applyCommand(chosen, snapshot(expanded, 2));
  expect(accepted.kind).toBe('acknowledged');
  if (accepted.kind !== 'acknowledged') throw new Error('Explicit whole-frame decision was refused');
  expect(frame(accepted.snapshot.value!)).toEqual(frame(mine));
  expect(accepted.snapshot.value!.title).toBe('Remote title');
});

it('keeps later unsent annotation work undecided after discarding an earlier refused edit', () => {
  const session = new DataSession(snapshot(base)); session.edit(mine);
  const command = session.prepare('offline-edit', 'owner')!;
  const later = annotate(mine, '6-9'); session.edit(later);
  session.accept({ kind: 'conflict', operationId: command.operationId, snapshot: snapshot(expanded, 2), conflicts: [] });
  session.applyCommit({ id: command.operationId, owner: 'owner', editorId: 'editor', editGeneration: 1, baseline: snapshot(base),
    value: mine, predecessor: null, revision: 2, initialized: true, working: snapshot(base), intended: mine, command,
    submitted: mine, sequence: 1, state: 'cancelled', result: null, unfinalized: [], cancelledByChoice: true });
  const state = session.getState();
  expect(frame(state.draft!)).toEqual(frame(later));
  expect(state.conflicts.map(conflict => conflict.path)).toEqual(paths);
  expect(state.remoteCandidate).toEqual(snapshot(expanded, 2));
  expect(session.prepare('silent-restore', 'owner')).toBeNull();
});

it('keeps post-submit annotation on its words when an acknowledgement replay already contains a changed passage', () => {
  const session = new DataSession(snapshot(base)); session.edit(mine);
  session.prepare('offline-edit', 'owner'); const later = annotate(mine, '6-9'); session.edit(later);
  session.accept({ kind: 'acknowledged', operationId: 'offline-edit', snapshot: snapshot(expanded, 3) });
  expect(frame(session.getState().draft!)).toEqual(frame(later));
  expect(session.getState().conflicts.map(conflict => conflict.path)).toEqual(paths);
  expect(session.prepare('silent-rebase', 'owner')).toBeNull();
});
