import {
  materializeOutlineNotes, outlineNoteSketchId, outlineNoteTargetOf, placeOfNode, scratchNoteAt,
  outlineWithPoint, outlineWithSubPoint, outlineWithoutPoint, outlineWithoutSubPoint, placeScratchNotes, POOL_PLACE,
  materializedNoteId, OLD_REMINDER_CREATED_AT, sameScratchPlace, scratchAfterOutlineChange, scratchByOutlineNode, scratchPlaceOf, sortScratch,
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
    expect(sorted.sections.main.points[0].subPoints.map((s) => [s.id, s.notes.map((n) => n.id)]))
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

  it('removes one point or one sub-point and nothing else', () => {
    expect(outlineWithoutPoint(outline, 'p-main').main).toEqual([]);
    expect(outlineWithoutPoint(outline, 'p-main').introduction).toEqual(outline.introduction);
    expect(outlineWithoutSubPoint(outline, 's-late').main[0].subPoints?.map((s) => s.id)).toEqual(['s-early']);
  });

  it('adds to an empty outline', () => {
    expect(outlineWithPoint(undefined, 'main', { id: 'p', text: 'Point' })).toEqual({ introduction: [], main: [{ id: 'p', text: 'Point' }], conclusion: [] });
  });


  it('gives each point and sub-point only its own notes, for the screens that show them', () => {
    const byNode = scratchByOutlineNode([
      note('on-point', { section: 'main', outlinePointId: 'p-main' }),
      note('on-sub', { section: 'main', outlinePointId: 'p-main', subPointId: 's-late' }),
      note('loose', { section: 'main' }),
      note('pool'),
      note('orphan', { section: 'main', outlinePointId: 'gone' }),
    ], outline);
    expect(byNode.get('p-main')?.map((n) => n.id)).toEqual(['on-point']);
    expect(byNode.get('s-late')?.map((n) => n.id)).toEqual(['on-sub']);
    expect([...byNode.keys()].sort()).toEqual(['p-main', 's-late']);
  });

  it('compares places by all three fields', () => {
    expect(sameScratchPlace({ section: 'main', pointId: 'p', subPointId: null }, { section: 'main', pointId: 'p', subPointId: null })).toBe(true);
    expect(sameScratchPlace({ section: 'main', pointId: 'p', subPointId: null }, { section: 'main', pointId: null, subPointId: null })).toBe(false);
  });
});

describe('a node\'s old one-line reminder as one of its notes', () => {
  const withReminders: SermonOutline = {
    introduction: [{ id: 'p-intro', text: 'Two walking together', note: 'Glued first and second' }],
    main: [{ id: 'p-main', text: 'Drift', subPoints: [{ id: 's-early', text: 'Early', position: 1, note: 'Sub reminder' }] }],
    conclusion: [],
  };
  const pointId = outlineNoteSketchId({ kind: 'point', id: 'p-intro' });
  const subId = outlineNoteSketchId({ kind: 'subpoint', id: 's-early' });

  it('is read as the first note of its node, with an id that names the node', () => {
    const sorted = sortScratch([note('a', { section: 'introduction', outlinePointId: 'p-intro' })], withReminders);
    expect(sorted.sections.introduction.points[0].notes.map((n) => n.id)).toEqual([pointId, 'a']);
    expect(sorted.sections.main.points[0].subPoints[0].notes.map((n) => n.text)).toEqual(['Sub reminder']);
    expect(outlineNoteTargetOf(pointId)).toEqual({ kind: 'point', id: 'p-intro' });
    expect(outlineNoteTargetOf(subId)).toEqual({ kind: 'subpoint', id: 's-early' });
    expect(outlineNoteTargetOf('a')).toBeNull();
    // the screens that draw the reminder from the node itself do not get it twice
    expect(scratchByOutlineNode([note('a', { section: 'introduction', outlinePointId: 'p-intro' })], withReminders).get('p-intro')?.map((n) => n.id)).toEqual(['a']);
  });

  it('becomes an ordinary note of the same node when moved: words kept, the old field cleared', () => {
    const fresh = materializedNoteId({ kind: 'point', id: 'p-intro' }, 'Glued first and second');
    const made = materializeOutlineNotes(withReminders, [note('a')], [pointId]);
    expect(made.ids.get(pointId)).toBe(fresh);
    expect(made.outline.introduction[0].note).toBeUndefined();
    expect(made.outline.main[0].subPoints?.[0].note).toBe('Sub reminder');
    expect(made.notes).toEqual([
      { id: fresh, text: 'Glued first and second', createdAt: OLD_REMINDER_CREATED_AT, section: 'introduction', outlinePointId: 'p-intro' },
      note('a'),
    ]);
    // then it moves like any note
    const moved = placeScratchNotes(made.notes, [fresh], { section: 'main', pointId: 'p-main', subPointId: 's-early' });
    expect(scratchPlaceOf(moved.find((n) => n.id === fresh)!, made.outline)).toEqual({ section: 'main', pointId: 'p-main', subPointId: 's-early' });
  });

  it('gives the same note to two devices that turn the same reminder into a note, and adds nothing twice', () => {
    const deviceA = materializeOutlineNotes(withReminders, [], [subId]);
    const deviceB = materializeOutlineNotes(withReminders, [], [subId]);
    expect(deviceA.notes.map((n) => n.id)).toEqual(deviceB.notes.map((n) => n.id));
    // A device that already has the note and still holds the old reminder clears it without a second copy.
    const stale = materializeOutlineNotes(withReminders, deviceA.notes, [subId]);
    expect(stale.notes.filter((n) => n.text === 'Sub reminder')).toHaveLength(1);
    expect(stale.outline.main[0].subPoints?.[0].note).toBeUndefined();
    // Gone already: nothing to do.
    const again = materializeOutlineNotes(deviceA.outline, deviceA.notes, [subId]);
    expect(again.notes).toEqual(deviceA.notes);
    expect(again.ids.size).toBe(0);
  });

  it('files a note added on a sub-point under its point and part', () => {
    expect(placeOfNode(withReminders, { kind: 'subpoint', id: 's-early' })).toEqual({ section: 'main', pointId: 'p-main', subPointId: 's-early' });
    expect(placeOfNode(withReminders, { kind: 'point', id: 'gone' })).toBeNull();
    expect(scratchNoteAt({ section: 'main', pointId: 'p-main', subPointId: null }, { id: 'n', text: 't', createdAt: 'c' }))
      .toEqual({ id: 'n', text: 't', createdAt: 'c', section: 'main', outlinePointId: 'p-main' });
  });
});

describe('scratch notes follow their nodes through an outline change', () => {
  const before: SermonOutline = {
    introduction: [{ id: 'p1', text: 'One', note: 'Old reminder of one', subPoints: [{ id: 's1', text: 'Sub', position: 1, note: 'Old reminder of sub' }] }],
    main: [{ id: 'p2', text: 'Two' }],
    conclusion: [],
  };
  const onPoint = note('a', { section: 'introduction', outlinePointId: 'p1' });
  const onSub = note('b', { section: 'introduction', outlinePointId: 'p1', subPointId: 's1' });
  const placeIn = (notes: ScratchNote[], id: string, outline: SermonOutline) => scratchPlaceOf(notes.find((n) => n.id === id)!, outline);

  it('moves a point\'s notes with the point to its new part', () => {
    const after: SermonOutline = { introduction: [], main: [before.main[0]], conclusion: [before.introduction[0]] };
    const notes = scratchAfterOutlineChange([onPoint, onSub], before, after);
    expect(notes.find((n) => n.id === 'a')?.section).toBe('conclusion');
    expect(placeIn(notes, 'b', after)).toEqual({ section: 'conclusion', pointId: 'p1', subPointId: 's1' });
  });

  it('keeps a re-parented sub-point\'s notes on it, and a nested point\'s notes on it as a sub-point', () => {
    const reparented: SermonOutline = { introduction: [{ id: 'p1', text: 'One' }], main: [{ id: 'p2', text: 'Two', subPoints: [{ id: 's1', text: 'Sub', position: 1 }] }], conclusion: [] };
    expect(placeIn(scratchAfterOutlineChange([onSub], before, reparented), 'b', reparented)).toEqual({ section: 'main', pointId: 'p2', subPointId: 's1' });
    const nested: SermonOutline = { introduction: [], main: [{ id: 'p2', text: 'Two', subPoints: [{ id: 'p1', text: 'One', position: 1 }] }], conclusion: [] };
    expect(placeIn(scratchAfterOutlineChange([onPoint], before, nested), 'a', nested)).toEqual({ section: 'main', pointId: 'p2', subPointId: 'p1' });
    const promoted: SermonOutline = { introduction: [{ id: 'p1', text: 'One' }, { id: 's1', text: 'Sub' }], main: [], conclusion: [] };
    expect(placeIn(scratchAfterOutlineChange([onSub], before, promoted), 'b', promoted)).toEqual({ section: 'introduction', pointId: 's1', subPointId: null });
  });

  it('leaves a removed sub-point\'s notes and old reminder on its point, and a removed point\'s in its part', () => {
    const withoutSub: SermonOutline = { ...before, introduction: [{ id: 'p1', text: 'One', note: 'Old reminder of one' }] };
    const afterSub = scratchAfterOutlineChange([onSub], before, withoutSub);
    expect(placeIn(afterSub, 'b', withoutSub)).toEqual({ section: 'introduction', pointId: 'p1', subPointId: null });
    const kept = afterSub.find((n) => n.text === 'Old reminder of sub');
    expect(kept && scratchPlaceOf(kept, withoutSub)).toEqual({ section: 'introduction', pointId: 'p1', subPointId: null });

    const withoutPoint: SermonOutline = { ...before, introduction: [] };
    const afterPoint = scratchAfterOutlineChange([onPoint, onSub], before, withoutPoint);
    expect(afterPoint.map((n) => n.text).sort()).toEqual(['Old reminder of one', 'Old reminder of sub', 'text a', 'text b']);
    afterPoint.forEach((n) => expect(scratchPlaceOf(n, withoutPoint)).toEqual({ section: 'introduction', pointId: null, subPointId: null }));
    // the same change run again (a replayed write) adds nothing
    expect(scratchAfterOutlineChange(afterPoint, before, withoutPoint)).toHaveLength(afterPoint.length);
  });

  it('clears a stored link to a removed node, even where the note already reads right', () => {
    const withoutSub: SermonOutline = { ...before, introduction: [{ id: 'p1', text: 'One' }] };
    const [kept] = scratchAfterOutlineChange([onSub], before, withoutSub).filter((n) => n.id === 'b');
    expect(kept).toEqual(note('b', { section: 'introduction', outlinePointId: 'p1' }));
  });

  it('takes back the converted copy when an undo brings the node and its reminder back', () => {
    const withoutPoint: SermonOutline = { ...before, introduction: [] };
    const removed = scratchAfterOutlineChange([], before, withoutPoint);
    expect(removed.map((n) => n.text).sort()).toEqual(['Old reminder of one', 'Old reminder of sub']);
    expect(scratchAfterOutlineChange(removed, withoutPoint, before)).toEqual([]);
    // a copy whose words the person has since edited is theirs and stays
    const edited = removed.map((n) => (n.text === 'Old reminder of one' ? { ...n, text: 'Old reminder of one, expanded' } : n));
    expect(scratchAfterOutlineChange(edited, withoutPoint, before).map((n) => n.text)).toEqual(['Old reminder of one, expanded']);
  });

  it('changes nothing when the outline change does not touch a note\'s node', () => {
    const renamed: SermonOutline = { ...before, main: [{ id: 'p2', text: 'Two renamed' }] };
    const notes = [onPoint, onSub, note('pool')];
    const after = scratchAfterOutlineChange(notes, before, renamed);
    after.forEach((n, i) => expect(n).toBe(notes[i]));
  });
});
