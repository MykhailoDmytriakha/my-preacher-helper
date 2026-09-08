import { dragIdFor, parseDragId, gapDropId, sectionDropId, intoPointDropId, subGapDropId, resolveOutlineDrop } from '@/components/plan-editor/outlineBoardModel';
import { indexScratchNotes } from '@/components/plan-editor/outlineBoardNotes';
import { NOTE_POOL_ID, notePointContainerId, noteSubContainerId } from '@/utils/boardDnd';
import type { ScratchNote, SermonOutline } from '@/models/models';

const makeOutline = (): SermonOutline => ({ introduction: [{ id: 'a', text: 'A', subPoints: [{ id: 's', text: 'S', position: 0 }] }, { id: 'b', text: 'B' }], main: [{ id: 'c', text: 'C' }], conclusion: [] });

it('round-trips identifiers containing colons and keeps the registered target vocabulary', () => {
  for (const kind of ['point', 'sub', 'note'] as const) expect(parseDragId(dragIdFor(kind, 'id:part'))).toEqual({ kind, id: 'id:part' });
  expect(parseDragId('other:id')).toBeNull();
  expect([gapDropId('main', 2), sectionDropId('main'), intoPointDropId('id:part'), subGapDropId('id:part', 1)])
    .toEqual(['gap:main:2', 'section:main', 'into-point:id:part', 'subgap:id:part:1']);
});

it('rejects foreign targets and missing sources without modifying the input', () => {
  const value = makeOutline();
  for (const target of ['other', 'subgap:missing-index', 'gap:other:1', 'section:other', 'into-point:missing']) {
    expect(resolveOutlineDrop(value, { kind: 'point', id: 'a' }, target)).toBeNull();
  }
  expect(resolveOutlineDrop(value, { kind: 'note', id: 'n' }, 'section:main')).toBeNull();
  expect(resolveOutlineDrop(value, { kind: 'point', id: 'missing' }, 'section:main')).toBeNull();
  expect(value).toEqual(makeOutline());
});

it('distinguishes a reorder from a section move and suppresses unchanged drops', () => {
  const value = makeOutline();
  expect(resolveOutlineDrop(value, { kind: 'point', id: 'a' }, 'gap:introduction:0')).toBeNull();
  const reorder = resolveOutlineDrop(value, { kind: 'point', id: 'b' }, 'gap:introduction:0');
  expect(reorder?.next.introduction.map(p => p.id)).toEqual(['b', 'a']);
  expect(reorder?.movedPointTo).toBeNull();
  const move = resolveOutlineDrop(value, { kind: 'point', id: 'a' }, 'gap:main:0');
  expect(move?.next.main.map(p => p.id)).toEqual(['a', 'c']);
  expect(move?.movedPointTo).toBe('main');
});

it('reports parent and placement changes for a gap whose point id contains colons', () => {
  const value = makeOutline(); value.main[0].id = 'c:part';
  const result = resolveOutlineDrop(value, { kind: 'sub', id: 's' }, 'subgap:c:part:0', { n: { pointId: 'a', subPointId: 's' } });
  expect(result?.subPointMove).toEqual({ sourcePointId: 'a', destinationPointId: 'c:part', section: 'main' });
  expect(result?.placementChanges).toEqual([{ noteId: 'n', placement: { pointId: 'c:part', subPointId: 's' } }]);
});

it('indexes once without losing caller order, object identity, or orphan placements', () => {
  const notes: ScratchNote[] = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, text: id, createdAt: '2026-01-01' }));
  const pool = [notes[3], notes[0]];
  const placements = { b: { pointId: 'p' }, c: { pointId: 'p' }, e: { pointId: 'orphan-parent', subPointId: 'orphan-sub' } };
  const index = indexScratchNotes({ pool, notesById: new Map(notes.map(n => [n.id, n])), placements });
  expect(index.get(NOTE_POOL_ID)).toBe(pool);
  expect(index.get(notePointContainerId('p'))).toEqual([notes[1], notes[2]]);
  expect(index.get(notePointContainerId('p'))?.[0]).toBe(notes[1]);
  expect(index.get(noteSubContainerId('orphan-sub'))).toEqual([notes[4]]);
  expect(index.size).toBe(3);
  expect(indexScratchNotes().size).toBe(0);
});
