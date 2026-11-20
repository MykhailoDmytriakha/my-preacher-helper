import {
  outlineWithPoint, outlineWithSubPoint, outlineWithoutPoint, outlineWithoutSubPoint, placeScratchNotes, POOL_PLACE,
  releaseScratchFromPoint, releaseScratchFromSubPoint, sameScratchPlace, scratchPlaceOf, sectionOfPoint, sortScratch,
} from '@/utils/scratchPlacement';

import type { ScratchNote, SermonOutline } from '@/models/models';

const note = (id: string, extra: Partial<ScratchNote> = {}): ScratchNote => ({ id, text: `text ${id}`, createdAt: '2026-11-19T00:00:00.000Z', ...extra });

const outline: SermonOutline = {
  introduction: [{ id: 'p-intro', text: 'Two walking together' }],
  main: [{ id: 'p-main', text: 'When a family drifts apart', subPoints: [{ id: 's-late', text: 'Late', position: 2 }, { id: 's-early', text: 'Early', position: 1 }] }],
  conclusion: [],
};

describe('scratchPlaceOf', () => {
  it('reads a note without a place as the pool', () => {
    expect(scratchPlaceOf(note('a'), outline)).toEqual(POOL_PLACE);
  });

  it('reads the part from the point, not from the note, when the point was moved to another part', () => {
    expect(scratchPlaceOf(note('a', { section: 'conclusion', outlinePointId: 'p-main' }), outline))
      .toEqual({ section: 'main', pointId: 'p-main', subPointId: null });
  });

  it('follows a sub-point to the point that holds it now', () => {
    expect(scratchPlaceOf(note('a', { section: 'introduction', outlinePointId: 'p-intro', subPointId: 's-early' }), outline))
      .toEqual({ section: 'main', pointId: 'p-main', subPointId: 's-early' });
  });

  it('keeps a note in its part when its point no longer exists', () => {
    expect(scratchPlaceOf(note('a', { section: 'main', outlinePointId: 'gone' }), outline))
      .toEqual({ section: 'main', pointId: null, subPointId: null });
  });

  it('keeps a note on its point when only its sub-point was removed', () => {
    expect(scratchPlaceOf(note('a', { section: 'main', outlinePointId: 'p-main', subPointId: 'gone' }), outline))
      .toEqual({ section: 'main', pointId: 'p-main', subPointId: null });
  });
});

describe('sortScratch', () => {
  it('puts every note in its container in the sermon note order, sub-points by position', () => {
    const notes = [
      note('pool-1'),
      note('loose', { section: 'main' }),
      note('on-point', { section: 'main', outlinePointId: 'p-main' }),
      note('on-late', { section: 'main', outlinePointId: 'p-main', subPointId: 's-late' }),
      note('pool-2'),
      note('intro', { section: 'introduction', outlinePointId: 'p-intro' }),
    ];
    const sorted = sortScratch(notes, outline);
    expect(sorted.pool.map((n) => n.id)).toEqual(['pool-1', 'pool-2']);
    expect(sorted.sections.main.loose.map((n) => n.id)).toEqual(['loose']);
    expect(sorted.sections.main.points[0].notes.map((n) => n.id)).toEqual(['on-point']);
    expect(sorted.sections.main.points[0].subPoints.map((s) => [s.subPoint.id, s.notes.map((n) => n.id)]))
      .toEqual([['s-early', []], ['s-late', ['on-late']]]);
    expect(sorted.sections.introduction.points[0].notes.map((n) => n.id)).toEqual(['intro']);
    expect(sorted.sections.conclusion).toEqual({ loose: [], points: [] });
  });

  it('works without an outline', () => {
    const sorted = sortScratch([note('a', { section: 'main' }), note('b')], undefined);
    expect(sorted.pool.map((n) => n.id)).toEqual(['b']);
    expect(sorted.sections.main.loose.map((n) => n.id)).toEqual(['a']);
  });
});

describe('placeScratchNotes', () => {
  it('changes only the place, never the words, and moves the notes to the end in the given order', () => {
    const notes = [note('a'), note('b'), note('c'), note('d')];
    const next = placeScratchNotes(notes, ['c', 'a'], { section: 'main', pointId: 'p-main', subPointId: null });
    expect(next.map((n) => n.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(next[2]).toEqual({ ...notes[2], section: 'main', outlinePointId: 'p-main' });
    expect(next[3].text).toBe('text a');
  });

  it('back to the pool clears every place field', () => {
    const next = placeScratchNotes([note('a', { section: 'main', outlinePointId: 'p-main', subPointId: 's-early' })], ['a'], POOL_PLACE);
    expect(next[0]).toEqual(note('a'));
  });

  it('a part without a point keeps no point', () => {
    const next = placeScratchNotes([note('a', { section: 'main', outlinePointId: 'p-main' })], ['a'], { section: 'introduction', pointId: null, subPointId: null });
    expect(next[0]).toEqual(note('a', { section: 'introduction' }));
  });

  it('lands right before the note it was dropped on', () => {
    const notes = [note('a'), note('b', { section: 'main' }), note('c', { section: 'main' }), note('d')];
    const next = placeScratchNotes(notes, ['d', 'a'], { section: 'main', pointId: null, subPointId: null }, 'c');
    expect(next.map((n) => n.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortScratch(next, outline).sections.main.loose.map((n) => n.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('falls back to the end when the note it was dropped on is itself moving', () => {
    const notes = [note('a'), note('b'), note('c')];
    expect(placeScratchNotes(notes, ['a', 'b'], POOL_PLACE, 'b').map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('ignores unknown ids', () => {
    const notes = [note('a')];
    expect(placeScratchNotes(notes, ['missing'], POOL_PLACE)).toEqual(notes);
  });
});

describe('outline edits', () => {
  it('adds a point at the end of a part and a sub-point after the last position', () => {
    const withPoint = outlineWithPoint(outline, 'conclusion', { id: 'p-new', text: 'Seek first' });
    expect(withPoint.conclusion).toEqual([{ id: 'p-new', text: 'Seek first' }]);
    const withSub = outlineWithSubPoint(withPoint, 'p-main', { id: 's-new', text: 'New' });
    expect(withSub.main[0].subPoints?.map((s) => [s.id, s.position])).toEqual([['s-late', 2], ['s-early', 1], ['s-new', 3]]);
  });

  it('adds to an empty outline', () => {
    expect(outlineWithPoint(undefined, 'main', { id: 'p', text: 'Point' })).toEqual({ introduction: [], main: [{ id: 'p', text: 'Point' }], conclusion: [] });
  });

  it('removing a point keeps its notes in its part', () => {
    expect(outlineWithoutPoint(outline, 'p-main').main).toEqual([]);
    const released = releaseScratchFromPoint([note('a', { section: 'main', outlinePointId: 'p-main', subPointId: 's-late' }), note('b')], 'p-main', 'main');
    expect(released).toEqual([note('a', { section: 'main' }), note('b')]);
  });

  it('removing a point files its notes in the part the outline has it in now, not the part a screen showed', () => {
    const moved: SermonOutline = { introduction: [], main: [], conclusion: [{ id: 'p-main', text: 'Moved', subPoints: [] }] };
    expect(sectionOfPoint(moved, 'p-main')).toBe('conclusion');
    expect(sectionOfPoint(moved, 'gone')).toBeUndefined();
    const onPoint = note('a', { section: 'main', outlinePointId: 'p-main', subPointId: 's-late' });
    expect(releaseScratchFromPoint([onPoint], 'p-main', sectionOfPoint(moved, 'p-main'))).toEqual([note('a', { section: 'conclusion' })]);
    // A point already gone: the note keeps its own part and only leaves the point.
    expect(releaseScratchFromPoint([onPoint], 'p-main', undefined)).toEqual([note('a', { section: 'main' })]);
  });

  it('removing a sub-point keeps its notes on the point', () => {
    expect(outlineWithoutSubPoint(outline, 's-late').main[0].subPoints?.map((s) => s.id)).toEqual(['s-early']);
    expect(releaseScratchFromSubPoint([note('a', { section: 'main', outlinePointId: 'p-main', subPointId: 's-late' })], 's-late'))
      .toEqual([note('a', { section: 'main', outlinePointId: 'p-main' })]);
  });

  it('compares places by all three fields', () => {
    expect(sameScratchPlace({ section: 'main', pointId: 'p', subPointId: null }, { section: 'main', pointId: 'p', subPointId: null })).toBe(true);
    expect(sameScratchPlace({ section: 'main', pointId: 'p', subPointId: null }, { section: 'main', pointId: null, subPointId: null })).toBe(false);
  });
});
