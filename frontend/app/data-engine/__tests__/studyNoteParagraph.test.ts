import { applyCommand, diffFields } from '../protocol';
import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';

// What a comment is in the reader — a paragraph or a comment — is the person's (case 2026-11-06-comment-paragraph): the
// engine takes a change of it as it takes a change of the words. A field the engine does not register is refused, so a
// switch made in the window would never reach the server.
const comment = (extra: DocumentData = {}): DocumentData => ({
  userId: 'owner', type: 'comment', content: 'Наставления дому', title: '', tags: [], isDraft: false,
  scriptureRefs: [{ id: 'r1', bible: 'rst', book: 'Colossians', chapter: 3, fromVerse: 18, toVerse: 21 }], ...extra,
});
const answer = (base: DocumentData, next: DocumentData) => {
  const resource = { collection: 'studyNotes', id: 'note' };
  const command: DataCommand = { protocol: 1, owner: 'owner', operationId: 'switch', resource, generation: 'g1', dependsOn: [], kind: 'update', changes: diffFields(base, next) };
  const snapshot: ResourceSnapshot = { resource, value: base, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } };
  return applyCommand(command, snapshot);
};

describe('a comment\'s kind in the engine', () => {
  it('makes a comment on a run of verses a comment, not a paragraph, and back', () => {
    expect(answer(comment(), comment({ paragraph: false }))).toMatchObject({ kind: 'acknowledged', snapshot: { value: { paragraph: false } } });
    expect(answer(comment({ paragraph: false }), comment({ paragraph: true }))).toMatchObject({ kind: 'acknowledged', snapshot: { value: { paragraph: true } } });
  });
});
