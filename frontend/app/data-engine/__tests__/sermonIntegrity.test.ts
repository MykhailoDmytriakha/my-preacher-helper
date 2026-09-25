import { applyCommand, diffFields } from '../protocol';
import { preservesSermonLinks } from '../sermonIntegrity';

import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';
const resource = { collection: 'sermons', id: 'sermon' };
const thought = { id: 'thought', text: 'Text', tags: [], date: 'today', outlinePointId: 'point', subPointId: 'sub' };
const outline = { introduction: [], main: [{ id: 'point', text: 'Point', subPoints: [{ id: 'sub', text: 'Sub', position: 0 }] }], conclusion: [] };
const structure = { introduction: [], main: ['thought'], conclusion: [], ambiguous: [] };
const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'Romans 1', date: 'today', thoughts: [thought], outline, structure, thoughtsBySection: structure };
const snapshot = (data: DocumentData): ResourceSnapshot => ({ resource, value: data, metadata: null });
const command = (base: DocumentData, next: DocumentData): DataCommand => ({ protocol: 1, operationId: 'op', owner: 'owner',
  resource, generation: null, dependsOn: [], kind: 'update', changes: diffFields(base, next) });

it.each([
  ['point', { outline: { ...outline, main: [] } }],
  ['subpoint', { outline: { ...outline, main: [{ id: 'point', text: 'Point' }] } }],
  ['orphan subpoint', { thoughts: [{ ...thought, outlinePointId: null }] }],
  ['wrong subpoint', { thoughts: [{ ...thought, subPointId: 'different' }] }],
  ['missing thought', { thoughts: [] }],
  ['duplicate placement', { structure: { ...structure, introduction: ['thought'] } }],
  ['duplicate alias placement', { thoughtsBySection: { ...structure, conclusion: ['thought'] } }],
] as [string, DocumentData][])('refuses new %s damage without changing any field', (_label, patch) => {
  const next = { ...value, ...patch };
  expect(preservesSermonLinks(value, next)).toBe(false);
  expect(applyCommand(command(value, next), snapshot(value))).toMatchObject({ kind: 'refused', code: 'invalid-document' });
  expect(value.thoughts).toEqual([thought]);
});

it('accepts removing the outline and clearing its thought links and placement atomically', () => {
  const next = { ...value, outline: { ...outline, main: [] }, thoughts: [{ ...thought, outlinePointId: null, subPointId: null }],
    structure: { ...structure, main: [], ambiguous: ['thought'] }, thoughtsBySection: { ...structure, main: [], ambiguous: ['thought'] } };
  expect(applyCommand(command(value, next), snapshot(value))).toMatchObject({ kind: 'acknowledged', snapshot: { value: next } });
});

it('refuses the merged result when individually valid changes orphan a concurrently assigned thought', () => {
  const base = { ...value, thoughts: [] };
  const next = { ...base, outline: { ...outline, main: [] } };
  const current = { ...value };
  expect(applyCommand(command(base, next), snapshot(current))).toMatchObject({ kind: 'refused', code: 'invalid-document' });
});

it('preserves existing legacy damage for unrelated edits and permits repairing it', () => {
  const broken = { ...value, outline: null, structure: 'legacy', thoughtsBySection: { main: ['missing', 'missing'] } };
  expect(preservesSermonLinks(broken, { ...broken, title: 'Edited' })).toBe(true);
  expect(applyCommand(command(broken, { ...broken, title: 'Edited' }), snapshot(broken))).toMatchObject({ kind: 'acknowledged' });
  expect(preservesSermonLinks(broken, value)).toBe(true);
  expect(preservesSermonLinks(broken, { ...broken, thoughts: [{ ...thought, outlinePointId: 'new-missing' }] })).toBe(false);
});

it('checks new documents and permits unassigned thoughts without optional structures', () => {
  const create: DataCommand = { protocol: 1, operationId: 'op', owner: 'owner', resource, generation: null, dependsOn: [], kind: 'create', value };
  expect(applyCommand(create, { resource, value: null, metadata: null })).toMatchObject({ kind: 'acknowledged' });
  expect(applyCommand({ ...create, value: { ...value, outline: { ...outline, main: [] } } }, { resource, value: null, metadata: null })).toMatchObject({ kind: 'refused' });
  expect(preservesSermonLinks(null, { thoughts: [{ id: 'a' }] })).toBe(true);
  expect(preservesSermonLinks(null, { thoughts: [null, 'legacy'], outline: [], structure: null })).toBe(true);
});

it('does not let an existing duplicate excuse adding a third placement', () => {
  const broken = { ...value, structure: { ...structure, introduction: ['thought'] } };
  expect(preservesSermonLinks(broken, { ...broken, structure: { ...broken.structure, conclusion: ['thought'] } })).toBe(false);
  expect(preservesSermonLinks(broken, value)).toBe(true);
});
