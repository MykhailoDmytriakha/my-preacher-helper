import { DataSession } from '../session';

import type { ResourceSnapshot } from '../types';

const note = (content: string, revision: number, title = 'Opening title'): ResourceSnapshot => ({
  resource: { collection: 'studyNotes', id: 'one' },
  value: { type: 'note', content, title },
  metadata: { protocol: 1, generation: 'note-generation', revision, deleted: false },
});

const field = (value: string) => ({ exists: true, value });
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
