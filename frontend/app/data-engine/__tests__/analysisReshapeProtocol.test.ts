import { validateCommand } from '../protocol';

import type { DataCommand, DocumentData, FieldChange, ResourceSnapshot } from '../types';

const sourceValue: DocumentData = {
  userId: 'owner', type: 'analysis', content: 'before source', title: 'Source', tags: [], isDraft: false,
  scriptureRefs: [{ id: 'source-ref', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 2 }],
  analysis: { bible: 'rst', words: 8, cuts: [5], links: { '5': 4 }, relations: { '4-5': { dir: 'fwd', color: 'amber' } } },
};
const after = (value: DocumentData, overrides: DocumentData = {}): DocumentData => ({ ...value, ...overrides });
const changes = (before: DocumentData, next: DocumentData): FieldChange[] => [
  { path: ['analysis'], before: { exists: true, value: before.analysis! }, after: { exists: true, value: next.analysis! } },
  { path: ['content'], before: { exists: true, value: before.content! }, after: { exists: true, value: next.content! } },
  { path: ['scriptureRefs'], before: { exists: true, value: before.scriptureRefs! }, after: { exists: true, value: next.scriptureRefs! } },
];
const noteEdit = (id: string, before: DocumentData, next: DocumentData, generation: string | null = `gen-${id}`) => ({
  resource: { collection: 'studyNotes', id }, generation, changes: changes(before, next),
});
const source: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'source' }, value: sourceValue,
  metadata: { protocol: 1, generation: 'gen-source', revision: 3, deleted: false } };
const validCommand = (): DataCommand => {
  const sourceAfter = after(sourceValue, { content: 'kept source words', scriptureRefs: [{ id: 'source-ref', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 2, toVerse: 2 }], analysis: { bible: 'rst', words: 4, cuts: [], links: {}, relations: {} } });
  const targetValue = after(sourceValue, { content: 'target text', scriptureRefs: [{ id: 'target-ref', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 3, toVerse: 3 }], analysis: { bible: 'rst', words: 4, cuts: [], links: {}, relations: {} } });
  const targetAfter = after(targetValue, { content: 'joined target text' });
  return {
    protocol: 1, operationId: 'reshape', owner: 'owner', resource: source.resource, generation: 'gen-source', dependsOn: [], kind: 'relation', relation: 'analysis-reshape',
    edits: [noteEdit('source', sourceValue, sourceAfter), noteEdit('target', targetValue, targetAfter)],
  } as unknown as DataCommand;
};

describe('analysis reshape wire command', () => {
  it('accepts two source-first study note frames', () => {
    expect(() => validateCommand(validCommand())).not.toThrow();
  });

  it.each([
    ['wrong participant collection', (command: Record<string, unknown>) => { (command.edits as Array<Record<string, unknown>>)[1].resource = { collection: 'sermons', id: 'target' }; }],
    ['duplicate participant', (command: Record<string, unknown>) => { (command.edits as unknown[])[1] = (command.edits as unknown[])[0]; }],
    ['source is not first', (command: Record<string, unknown>) => { (command.edits as unknown[]).reverse(); }],
    ['missing authored frame field', (command: Record<string, unknown>) => { (command.edits as Array<Record<string, unknown>>)[0].changes = ((command.edits as Array<{ changes: FieldChange[] }>)[0].changes).filter(change => change.path[0] !== 'content'); }],
    ['title cannot replace an authored frame field', (command: Record<string, unknown>) => { (command.edits as Array<{ changes: FieldChange[] }>)[0].changes[1].path = ['title']; }],
    ['caller cannot set updatedAt', (command: Record<string, unknown>) => { (command.edits as Array<{ changes: FieldChange[] }>)[0].changes.push({ path: ['updatedAt'], before: { exists: true, value: 'a' }, after: { exists: true, value: 'b' } }); }],
    ['a new note cannot be the source', (command: Record<string, unknown>) => { const edits = command.edits as Array<Record<string, unknown>>; edits[0].create = { userId: 'owner' }; edits[0].generation = null; edits[0].changes = []; command.generation = null; }],
    ['an absent recipient cannot mix create and update fields', (command: Record<string, unknown>) => { const edits = command.edits as Array<Record<string, unknown>>; edits[1].create = { userId: 'owner', type: 'analysis', content: '', scriptureRefs: [], analysis: {} }; }],
    ['the primary generation must match the source edit', (command: Record<string, unknown>) => { (command.edits as Array<Record<string, unknown>>)[0].generation = 'stale'; }],
  ])('rejects %s', (_label, corrupt) => {
    const command = validCommand() as unknown as Record<string, unknown>;
    corrupt(command);
    expect(() => validateCommand(command)).toThrow();
  });

  it('accepts an absent recipient carrying a complete creation document', () => {
    const command = validCommand() as unknown as Record<string, unknown>;
    const edits = command.edits as Array<Record<string, unknown>>;
    edits[1] = {
      resource: { collection: 'studyNotes', id: 'new-recipient' }, generation: null, changes: [],
      create: { userId: 'owner', type: 'analysis', title: 'New analysis', content: 'Words', tags: [], isDraft: false,
        createdAt: 'created', updatedAt: 'updated', scriptureRefs: [{ id: 'new-ref', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 3, toVerse: 3 }],
        analysis: { bible: 'rst', words: 4, cuts: [], links: {}, relations: {} } },
    };
    expect(() => validateCommand(command)).not.toThrow();
  });
});
