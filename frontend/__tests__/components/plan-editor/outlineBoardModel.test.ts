import { dragIdFor, parseDragId, gapDropId, sectionDropId, intoPointDropId, subGapDropId, resolveOutlineDrop, describeDropPlace } from '@/components/plan-editor/outlineBoardModel';
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

describe('describeDropPlace', () => {
  const outline = {
    introduction: [],
    main: [{ id: 'p1', text: 'Grace before law', subPoints: [{ id: 's1', text: 'The promise to Abraham', position: 1 }] }],
    conclusion: [],
  } as unknown as SermonOutline;

  it('names every target of the board the way a screen reader can say it', () => {
    expect(describeDropPlace('section:main', outline)).toEqual({ kind: 'sectionEnd', section: 'main' });
    expect(describeDropPlace('gap:main:0', outline)).toEqual({ kind: 'sectionAt', section: 'main', position: 1 });
    expect(describeDropPlace('into-point:p1', outline)).toEqual({ kind: 'inside', point: 'Grace before law' });
    expect(describeDropPlace('subgap:p1:1', outline)).toEqual({ kind: 'inside', point: 'Grace before law', position: 2 });
    expect(describeDropPlace('note-sub:s1', outline)).toEqual({ kind: 'notes', point: 'The promise to Abraham' });
    expect(describeDropPlace('scratch-note-pool', outline)).toEqual({ kind: 'pool' });
    expect(describeDropPlace('something-else', outline)).toBeNull();
  });
});

// BUG-20261006-drag-announcement-place-imprecise: the place said is where the card will land, and two places never sound alike.
describe('describeDropPlace for the card being carried', () => {
  const outline = {
    introduction: [],
    main: [
      { id: 'a', text: 'Grace', subPoints: [] },
      { id: 'b', text: 'Faith', subPoints: [{ id: 's1', text: 'Same words', position: 1 }, { id: 's2', text: 'Same words', position: 2 }] },
      { id: 'c', text: 'Hope', subPoints: [] },
    ],
    conclusion: [{ id: 'd', text: 'Love', subPoints: [] }],
  } as unknown as SermonOutline;

  it('says the position the carried point will take, after leaving its own place', () => {
    expect(describeDropPlace('gap:main:2', outline, { kind: 'point', id: 'a' })).toEqual({ kind: 'sectionAt', section: 'main', position: 2 });
    expect(describeDropPlace('gap:main:2', outline, { kind: 'point', id: 'd' })).toEqual({ kind: 'sectionAt', section: 'main', position: 3 });
  });

  it('says the position a carried sub-point will take among its new neighbours', () => {
    expect(describeDropPlace('subgap:b:2', outline, { kind: 'sub', id: 's1' })).toEqual({ kind: 'inside', point: 'Faith', position: 2 });
  });

  it('says a place the carried point cannot land in as nowhere', () => {
    expect(describeDropPlace('subgap:a:0', outline, { kind: 'point', id: 'a' })).toEqual({ kind: 'nowhere' });
    expect(describeDropPlace('into-point:a', outline, { kind: 'point', id: 'a' })).toEqual({ kind: 'nowhere' });
  });

  it('never numbers two points into a label another point already reads as', () => {
    const alike = {
      introduction: [{ id: 'x', text: 'Same words', subPoints: [] }, { id: 'y', text: 'Same words', subPoints: [] }, { id: 'z', text: 'Same words (1)', subPoints: [] }],
      main: [], conclusion: [],
    } as unknown as SermonOutline;
    const labels = ['x', 'y', 'z'].map(id => describeDropPlace(`note-point:${id}`, alike));
    expect(new Set(labels.map(place => JSON.stringify(place))).size).toBe(3);
    expect(labels[2]).toEqual({ kind: 'notes', point: 'Same words (1)' });
  });

  it('tells apart two points with the same words', () => {
    expect(describeDropPlace('note-sub:s1', outline)).toEqual({ kind: 'notes', point: 'Same words (1)' });
    expect(describeDropPlace('note-sub:s2', outline)).toEqual({ kind: 'notes', point: 'Same words (2)' });
  });
});
