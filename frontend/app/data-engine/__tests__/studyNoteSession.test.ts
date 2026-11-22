import { uncapturedAutosaveFields } from '../documentFieldAction';
import { validateRecoveryRecord } from '../recovery.client';
import { DataSession } from '../session';
import { keepUncontestedLegacyComment, type LegacyStudyCommentEdit } from '../studyNoteLegacyDraft';

import type { ResourceSnapshot } from '../types';

const note = (content: string, revision: number, title = 'Opening title'): ResourceSnapshot => ({
  resource: { collection: 'studyNotes', id: 'one' },
  value: { type: 'note', content, title },
  metadata: { protocol: 1, generation: 'note-generation', revision, deleted: false },
});

const field = <Value extends string | boolean>(value: Value) => ({ exists: true, value });
const stamp = { field: 'content', time: null } as const;

it('keeps both texts when a keystroke reaches the screen before an accepted copy is displayed', () => {
  const editor = new DataSession(note('Opening', 1));
  const shown = editor.checkpoint();
  const received = note('Words from phone', 2, 'Title from phone');

  editor.observe(received, { source: 'server' });
  editor.edit({ ...received.value, content: 'Opening and a new word' }, shown, stamp);

  expect(editor.checkpoint()).toMatchObject({
    confirmed: received,
    remoteCandidate: received,
    draft: { content: 'Opening and a new word', title: 'Title from phone' },
    conflicts: [{ path: ['content'], base: field('Opening'), mine: field('Opening and a new word'), theirs: field('Words from phone') }],
  });
});

it.each([
  ['First edit', [], 'First edit and a new word'],
  ['Words from phone', ['content'], 'First edit and a new word'],
])('does not rebase new words as if they were typed on an unseen acknowledgement: %s', (stored, conflicts, local) => {
  const editor = new DataSession(note('Opening', 1));
  const shown = editor.checkpoint();
  editor.edit({ ...shown.draft, content: 'First edit' }, shown, stamp);
  const first = editor.checkpoint();
  editor.registerCommit('first', first.editGeneration, first.draft, undefined, {
    studyNoteContentAction: {
      before: field('Opening'), after: field('First edit'), observedRevision: 1, time: null,
    },
  });
  editor.edit({ ...first.draft, content: local }, editor.checkpoint(), stamp);

  editor.accept({ kind: 'acknowledged', operationId: 'first', snapshot: note(stored, 2, 'Title from phone') });

  expect(editor.checkpoint().conflicts.map(conflict => conflict.path[0])).toEqual(conflicts);
  expect(editor.checkpoint().draft).toMatchObject({ content: local, title: 'Title from phone' });
  expect(editor.checkpoint().confirmed.value?.content).toBe(stored);
});

it('uses the exact own acknowledgement when a successor was typed before the first capture registered', () => {
  const editor = new DataSession(note('Opening', 1));
  const shown = editor.checkpoint();
  editor.edit({ ...shown.draft, content: 'First edit' }, shown, stamp);
  const first = editor.checkpoint();
  editor.edit({ ...first.draft, content: 'First edit and a new word' }, first, stamp);
  editor.registerCommit('first', first.editGeneration, first.draft, undefined, {
    studyNoteContentAction: {
      before: field('Opening'), after: field('First edit'), observedRevision: 1, time: null,
    },
  });
  const accepted = note('First edit', 2);
  accepted.metadata!.operationId = 'first';

  editor.accept({ kind: 'acknowledged', operationId: 'first', snapshot: accepted });

  expect(editor.checkpoint()).toMatchObject({
    conflicts: [],
    draft: { content: 'First edit and a new word' },
    studyNoteContentDraft: {
      action: { before: field('First edit'), after: field('First edit and a new word'), observedRevision: 2 },
    },
  });
});

it('retains a comment keystroke and its passage when a saved comment arrives before the redraw', () => {
  const comment = (content: string, revision: number, verse: number): ResourceSnapshot => ({
    ...note(content, revision),
    value: { type: 'comment', content, scriptureRefs: [{ id: 'passage', book: 'Isaiah', chapter: 40, fromVerse: verse }] },
  });
  const editor = new DataSession(comment('Opening words', 1, 31));
  const shown = editor.checkpoint();
  const received = comment('Server words', 2, 30);
  editor.observe(received, { source: 'server' });
  editor.edit({ ...received.value, content: 'Opening words and the next keystroke' }, shown, stamp);

  expect(editor.checkpoint()).toMatchObject({
    confirmed: received,
    remoteCandidate: received,
    draft: { content: 'Opening words and the next keystroke', scriptureRefs: received.value?.scriptureRefs },
    conflicts: [{ path: ['content'], base: field('Opening words'), mine: field('Opening words and the next keystroke'), theirs: field('Server words') }],
    studyNoteContentDraft: { action: { before: field('Opening words'), after: field('Opening words and the next keystroke'), observedRevision: 1 } },
  });
});

it('preserves a staged comment kind with the passage and action time across a reopened editor', () => {
  const time = { earliestMs: 60, latestMs: 65 };
  const passage = { id: 'passage', book: 'Isaiah', chapter: 40, fromVerse: 31 };
  const opening = { ...note('Opening words', 1), value: { type: 'comment', userId: 'owner', content: 'Opening words', scriptureRefs: [passage], paragraph: false } };
  const editor = new DataSession(opening);
  editor.edit({ ...opening.value, paragraph: true }, editor.checkpoint(), { field: 'paragraph', time });
  const persisted = JSON.parse(JSON.stringify({ owner: 'owner', editorId: 'editor', prepared: null, checkpoint: editor.checkpoint() }));
  const resumed = DataSession.restore(validateRecoveryRecord(persisted, 'owner', 'editor').checkpoint);
  resumed.edit({ ...resumed.checkpoint().draft, content: 'Newer words in the same comment' });

  expect(uncapturedAutosaveFields(resumed.checkpoint(), opening, undefined, [])).toMatchObject({
    commentKindAction: {
      before: { exists: true, value: false }, after: { exists: true, value: true },
      reference: { exists: true, value: [passage] }, observedRevision: 1, time,
    },
  });
});

it('preserves the leading comment place and its action time without copying another reference', () => {
  const time = { earliestMs: 70, latestMs: 75 };
  const passage = { id: 'passage', book: 'Isaiah', chapter: 40, fromVerse: 31 };
  const moved = { ...passage, fromVerse: 28 };
  const secondary = { id: 'secondary', book: 'John', chapter: 1, fromVerse: 1 };
  const opening = { ...note('Opening words', 1), value: {
    type: 'comment', userId: 'owner', content: 'Opening words', scriptureRefs: [passage, secondary], paragraph: false,
  } };
  const editor = new DataSession(opening);
  editor.edit({ ...opening.value, scriptureRefs: [moved, secondary] }, editor.checkpoint(), { field: 'scriptureRefs', time });
  const stored = JSON.parse(JSON.stringify({ owner: 'owner', editorId: 'editor', prepared: null, checkpoint: editor.checkpoint() }));
  const recovered = validateRecoveryRecord(stored, 'owner', 'editor').checkpoint;

  expect(uncapturedAutosaveFields(recovered, opening, undefined, [])).toMatchObject({
    commentPlaceAction: {
      before: { exists: true, value: passage }, after: { exists: true, value: moved },
      paragraph: { exists: true, value: false }, observedRevision: 1, time,
    },
  });
  expect(recovered.draft?.scriptureRefs).toEqual([moved, secondary]);
});

it('captures a move and a changed kind as one scope bounded by the saved passage', () => {
  const passage = { id: 'passage', book: 'Isaiah', chapter: 40, fromVerse: 31 };
  const moved = { ...passage, fromVerse: 28 };
  const opening = { ...note('Opening words', 1), value: {
    type: 'comment', userId: 'owner', content: 'Opening words', scriptureRefs: [passage], paragraph: false,
  } };
  const editor = new DataSession(opening);
  const kindTime = { earliestMs: 55, latestMs: 60 };
  const moveTime = { earliestMs: 70, latestMs: 75 };
  editor.edit({ ...opening.value, paragraph: true }, editor.checkpoint(), { field: 'paragraph', time: kindTime });
  editor.edit({ ...editor.checkpoint().draft, scriptureRefs: [moved] }, editor.checkpoint(), { field: 'scriptureRefs', time: moveTime });

  const actions = uncapturedAutosaveFields(editor.checkpoint(), opening, undefined, []);
  expect(actions.commentKindAction).toMatchObject({
    before: { exists: true, value: false }, after: { exists: true, value: true }, time: kindTime,
  });
  expect(actions.commentPlaceAction).toMatchObject({
    before: { exists: true, value: passage }, after: { exists: true, value: moved },
    paragraph: { exists: true, value: false }, observedRevision: 1, time: moveTime, compound: true,
  });
  const submitted = editor.checkpoint();
  expect(submitted.draft).toMatchObject({ paragraph: true, scriptureRefs: [moved] });
  editor.registerCommit('compound', submitted.editGeneration, submitted.draft, undefined, actions);
  const accepted = { ...opening, value: { ...opening.value, paragraph: true, scriptureRefs: [moved] },
    metadata: { ...opening.metadata!, revision: 2, operationId: 'compound' } };
  editor.accept({ kind: 'acknowledged', operationId: 'compound', snapshot: accepted });
  expect(editor.checkpoint()).toMatchObject({ dirty: false, conflicts: [] });
  expect(uncapturedAutosaveFields(editor.checkpoint(), accepted, undefined, [])).toEqual({});
});

it('keeps a second staged move when the first move is acknowledged', () => {
  const passage = { id: 'passage', book: 'Isaiah', chapter: 40, fromVerse: 31 };
  const firstPlace = { ...passage, fromVerse: 28 };
  const secondPlace = { ...passage, fromVerse: 30 };
  const secondary = { id: 'secondary', book: 'John', chapter: 1, fromVerse: 1 };
  const opening = { ...note('Opening words', 1), value: {
    type: 'comment', userId: 'owner', content: 'Opening words', scriptureRefs: [passage, secondary], paragraph: false,
  } };
  const editor = new DataSession(opening);
  editor.edit({ ...opening.value, scriptureRefs: [firstPlace, secondary] }, editor.checkpoint(), { field: 'scriptureRefs', time: null });
  const first = editor.checkpoint();
  const actions = uncapturedAutosaveFields(first, opening, undefined, []);
  editor.registerCommit('first', first.editGeneration, first.draft, undefined, actions);
  editor.edit({ ...opening.value, scriptureRefs: [secondPlace, secondary] }, editor.checkpoint(), { field: 'scriptureRefs', time: null });

  editor.accept({ kind: 'acknowledged', operationId: 'first', snapshot: {
    ...opening, value: { ...opening.value, scriptureRefs: [firstPlace, secondary] },
    metadata: { ...opening.metadata!, revision: 2, operationId: 'first' },
  } });

  expect(editor.checkpoint()).toMatchObject({
    conflicts: [],
    draft: { scriptureRefs: [secondPlace, secondary] },
  });
});

describe('legacy comment recovery in the document session', () => {
  const reference = (fromVerse: number, id = 'passage') => ({ id, book: 'Isaiah', chapter: 40, fromVerse });
  const secondary = reference(12, 'secondary');
  const comment = (overrides: Record<string, string | boolean | ReturnType<typeof reference>[]>) => ({
    ...note('Saved words', 5),
    value: { type: 'comment', userId: 'owner', content: 'Saved words', title: 'Saved title',
      paragraph: false, scriptureRefs: [reference(31), secondary], ...overrides },
  });
  const restore = (editor: DataSession, edits: LegacyStudyCommentEdit[]) => editor.importLegacyStudyNote({ kind: 'comment', edits });
  const place = (fromVerse: number, id?: string) => ({ exists: true, value: reference(fromVerse, id) });

  it('brings back a changed kind without taking the old words or assigning it a new action time', () => {
    const saved = comment({});
    const editor = new DataSession(saved);
    restore(editor, [{ field: 'paragraph', opening: field(false), referenceOpening: place(31), value: field(true) }]);

    expect(editor.checkpoint()).toMatchObject({
      draft: { ...saved.value, paragraph: true }, conflicts: [], remoteCandidate: null,
    });
    expect(editor.checkpoint().commentKindDraft).toBeUndefined();
  });

  it('compares older words but imports an independent move with its original address and current sibling references', () => {
    const saved = comment({});
    const editor = new DataSession(saved);
    restore(editor, [
      { field: 'content', opening: field('Older words'), value: field('Words typed offline') },
      { field: 'place', opening: place(31), paragraphOpening: field(false), value: place(30) },
    ]);

    const serialized = JSON.parse(JSON.stringify({ owner: 'owner', editorId: 'recovered-comment', prepared: null, checkpoint: editor.checkpoint() }));
    const resumed = DataSession.restore(validateRecoveryRecord(serialized, 'owner', 'recovered-comment').checkpoint);
    expect(resumed.checkpoint()).toMatchObject({
      draft: { ...saved.value, content: 'Words typed offline', scriptureRefs: [reference(30), secondary] },
      conflicts: [{ path: ['content'], base: field('Older words'), mine: field('Words typed offline'), theirs: field('Saved words') }],
    });
    const checkpoint = resumed.checkpoint();
    expect(checkpoint.commentPlaceDraft).toBeUndefined();
    expect(keepUncontestedLegacyComment(checkpoint.confirmed, checkpoint.draft, checkpoint.remoteCandidate, checkpoint.conflicts))
      .toMatchObject({ ...saved.value, scriptureRefs: [reference(30), secondary] });
    expect(resumed.prepare('unanswered', 'owner')).toBeNull();
  });

  it('keeps both places when the historical opening is missing', () => {
    const editor = new DataSession(comment({}));
    restore(editor, [{ field: 'place', value: place(30) }]);
    expect(editor.checkpoint()).toMatchObject({
      conflicts: [{ path: ['scriptureRefs', 'id:passage'], base: { exists: false }, mine: place(30), theirs: place(31) }],
    });
    expect(editor.checkpoint().commentPlaceDraft).toBeUndefined();
  });

  it('does not recreate a leading reference replaced while the recovered copy is being compared', () => {
    const initial = comment({});
    const editor = new DataSession(initial);
    restore(editor, [{ field: 'place', value: place(30) }]);
    editor.observe({
      ...initial, metadata: { ...initial.metadata!, revision: 6 },
      value: { ...initial.value, scriptureRefs: [reference(31, 'replacement'), secondary] },
    }, { source: 'server' });
    const beforeChoice = editor.checkpoint();

    expect(() => editor.keepLocal()).toThrow(expect.objectContaining({ code: 'decision-changed' }));
    expect(editor.checkpoint()).toEqual(beforeChoice);
  });

  it('leaves the editor untouched if the retained move belongs to a different leading reference', () => {
    const editor = new DataSession(comment({ scriptureRefs: [reference(31, 'replacement'), secondary] }));
    const opening = editor.checkpoint();
    expect(() => restore(editor, [{ field: 'place', opening: place(31), paragraphOpening: field(false), value: place(30) }]))
      .toThrow(expect.objectContaining({ code: 'decision-changed' }));
    expect(editor.checkpoint()).toEqual(opening);
  });
});
