import { applyCommand, diffFields, mergeDocumentFields, mergeFields } from '../protocol';
import { DataSession } from '../session';

import type { DataCommand, DocumentData, Json, ResourceSnapshot } from '../types';

const resource = { collection: 'studyNotes', id: 'note' };
const legacy = { id: 'old', book: 'Psalms', chapter: 9, fromVerse: 1 };
const added = { id: 'added', bible: 'rst', book: 'John', chapter: 3, fromVerse: 16 };
const note = (refs: Json[]): DocumentData & { scriptureRefs: Json[] } => ({ userId: 'owner', title: 'Own note', content: 'Keep these words',
  tags: [], scriptureRefs: refs, isDraft: true, type: 'note', materialIds: [], createdAt: 'created', updatedAt: 'updated' });
function save(base: DocumentData, mine: DocumentData, theirs: DocumentData) {
  const command: DataCommand = { protocol: 1, operationId: 'edit', owner: 'owner', resource,
    generation: 'same-note', dependsOn: [], kind: 'update', changes: diffFields(base, mine) };
  const current: ResourceSnapshot = { resource, value: theirs,
    metadata: { protocol: 1, generation: 'same-note', revision: 3, deleted: false } };
  return { result: applyCommand(command, current), current };
}

describe('scripture reference meaning through shared command merging', () => {
  it('refuses a Bible marker from one legacy copy combined with a changed Psalm number', () => {
    const base = note([legacy]);
    const mine = note([{ ...legacy, bible: 'rst' }, added]);
    const theirs = note([{ ...legacy, chapter: 10 }]);
    const { result, current } = save(base, mine, theirs);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: current, conflicts: [{
      path: ['scriptureRefs', 'id:old'], base: { exists: true, value: legacy },
      mine: { exists: true, value: mine.scriptureRefs[0] }, theirs: { exists: true, value: theirs.scriptureRefs[0] },
    }] });
    expect(theirs.scriptureRefs).toEqual([{ ...legacy, chapter: 10 }]);
    expect(theirs.content).toBe('Keep these words');
  });

  it('protects the same legacy reference during document rebases', () => {
    const base = note([legacy]);
    const mine = note([{ ...legacy, bible: 'rst' }, added]);
    const theirs = note([{ ...legacy, chapter: 10 }]);
    const merged = mergeDocumentFields(base, mine, theirs);
    expect(merged.conflicts.map(conflict => conflict.path)).toEqual([['scriptureRefs', 'id:old']]);
    expect(merged.value.value).toMatchObject({ scriptureRefs: mine.scriptureRefs, content: base.content });
  });

  it.each([
    [{ chapter: 11 }, { fromVerse: 2 }],
    [{ book: 'John' }, { chapter: 12 }],
    [{ endChapter: 12, toVerse: 3 }, { toVerse: 4 }],
    [{ bible: 'kjv' }, { text: 'A quote retained in the original Bible' }],
  ])('keeps divergent edits of one reference together (%j / %j)', (mineChange, theirChange) => {
    const ref = { ...legacy, bible: 'rst', toVerse: 2 };
    const { result } = save(note([ref]), note([{ ...ref, ...mineChange }]), note([{ ...ref, ...theirChange }]));
    expect(result.kind).toBe('conflict');
  });

  it('accepts naming the Bible when the stored reference did not change', () => {
    const mine = note([{ ...legacy, bible: 'rst' }, added]);
    const { result } = save(note([legacy]), mine, note([legacy]));
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { scriptureRefs: mine.scriptureRefs } } });
  });

  it('accepts matching changes to the same reference', () => {
    const canonical = { ...legacy, bible: 'rst' };
    const { result } = save(note([legacy]), note([canonical, added]), note([canonical]));
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { scriptureRefs: [canonical, added] } } });
  });

  it('merges independent edits to separate references and preserves the paragraph', () => {
    const other = { id: 'other', bible: 'rst', book: 'John', chapter: 1, fromVerse: 1 };
    const canonical = { ...legacy, bible: 'rst' };
    const changedOther = { ...other, fromVerse: 2 };
    const { result } = save(note([legacy, other]), note([canonical, other, added]), note([legacy, changedOther]));
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
      scriptureRefs: [canonical, changedOther, added], content: 'Keep these words',
    } } });
  });

  it.each(['mine', 'stored'] as const)('resolves a delivered whole-reference conflict by explicit %s choice', choice => {
    const other = { id: 'other', bible: 'rst', book: 'John', chapter: 1, fromVerse: 1 };
    const changedOther = { ...other, fromVerse: 2 };
    const canonical = { ...legacy, bible: 'rst' };
    const before: ResourceSnapshot = { resource, value: note([legacy, other]),
      metadata: { protocol: 1, generation: 'same-note', revision: 1, deleted: false } };
    const remote: ResourceSnapshot = { ...before, value: note([{ ...legacy, chapter: 10 }, changedOther]),
      metadata: { ...before.metadata!, revision: 3 } };
    const session = new DataSession(before);
    session.edit(note([canonical, other, added]));
    const command = session.prepare('first', 'owner')!;
    const conflict = applyCommand(command, remote);
    expect(conflict.kind).toBe('conflict');
    session.accept(conflict);
    expect(session.getState().draft?.scriptureRefs).toEqual([canonical, other, added]);
    expect(session.getState().conflicts.map(detail => detail.path)).toEqual([['scriptureRefs', 'id:old']]);
    expect(() => session.keepLocal()).toThrow('Resolve pending');
    // This unit owns a terminal conflict result; production settles its durable scope first.
    session.release(command.operationId);
    if (choice === 'stored') {
      session.acceptRemote();
      expect(session.getState()).toMatchObject({ draft: remote.value, dirty: false, conflicts: [] });
    } else {
      session.keepLocal();
      expect(session.getState()).toMatchObject({ dirty: true, conflicts: [], draft: {
        scriptureRefs: [canonical, changedOther, added], content: 'Keep these words',
      } });
      const retry = session.prepare('resolved', 'owner')!;
      const accepted = applyCommand(retry, remote);
      expect(accepted.kind).toBe('acknowledged');
      session.accept(accepted);
      expect(session.getState()).toMatchObject({ dirty: false, conflicts: [], draft: {
        scriptureRefs: [canonical, changedOther, added], content: 'Keep these words',
      } });
    }
  });

  it('keeps ordinary keyed objects and string reference lists using their existing merge', () => {
    const field = (value: Json) => ({ exists: true, value });
    const ordinary = mergeFields(field([{ id: 'item', chapter: 1, fromVerse: 1 }]),
      field([{ id: 'item', chapter: 2, fromVerse: 1 }]), field([{ id: 'item', chapter: 1, fromVerse: 2 }]), ['other']);
    expect(ordinary).toEqual({ value: field([{ id: 'item', chapter: 2, fromVerse: 2 }]), conflicts: [] });
    const strings = mergeFields(field(['John 1:1']), field(['John 1:1', 'John 2:1']),
      field(['John 1:1', 'John 3:1']), ['scriptureRefs']);
    expect(strings.conflicts).toEqual([]);
    expect(strings.value.value).toEqual(expect.arrayContaining(['John 1:1', 'John 2:1', 'John 3:1']));
  });
});
