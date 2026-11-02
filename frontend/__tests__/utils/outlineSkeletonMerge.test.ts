import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import { mergeOutline } from '@/utils/mergeOutline';
import { sortSubPointsByPosition } from '@/utils/subPoints';
import { OutlineCapture } from '@/utils/outlineCapture';

import type { DocumentData } from '@/data-engine/types';
import type { OutlinePoint, SermonOutline, SubPoint } from '@/models/models';

const sub = (id: string, text = id, position = 1000): SubPoint => ({ id, text, position });
const outline = (subPoints: SubPoint[], extra: Partial<OutlinePoint> = {}): SermonOutline => ({
  introduction: [{ id: 'p', text: 'First point', subPoints, ...extra }],
  main: [{ id: 'unrelated', text: 'Independent point', note: 'Keep this note' }], conclusion: [],
});
const visibleIds = (value: SermonOutline): string[] => sortSubPointsByPosition(value.introduction[0].subPoints).map(item => item.id);
const document = (value: SermonOutline): DocumentData => ({
  userId: 'outline-owner', title: 'Sermon', verse: 'John 3:16', date: '2026-11-01', thoughts: [], outline: value as unknown as DocumentData,
});

/** BUG-20261011-outline-point-skeleton-both-sides: draft input stays open while a saved copy arrives. */
describe('independent subpoint work through the ordinary outline writer', () => {
  it('keeps the two different first subpoints without asking about independent additions', () => {
    const result = mergeOutline(outline([]), outline([sub('a', 'Local words')]), outline([sub('b', 'Saved words')]));
    expect(result.collisions).toEqual([]);
    expect(new Set(visibleIds(result.outline))).toEqual(new Set(['a', 'b']));
    expect(result.outline.main).toEqual(outline([]).main);
  });

  it('composes a new subpoint with the saved visible reorder, irrespective of position magnitudes', () => {
    const base = outline([sub('a', 'A', 0), sub('b', 'B', 1)]);
    const mine = outline([sub('a', 'A', 0), sub('b', 'B', 1), sub('c', 'C', 1001)]);
    const theirs = outline([sub('b', 'B', 1000), sub('a', 'A', 2000)]);
    const result = mergeOutline(base, mine, theirs);
    expect(result.collisions).toEqual([]);
    expect(visibleIds(result.outline)).toEqual(['b', 'a', 'c']);
    expect(result.outline.introduction[0].subPoints?.map(item => item.text)).toEqual(['B', 'A', 'C']);
  });

  it('keeps a deletion and independent words on a surviving subpoint', () => {
    const base = outline([sub('a', 'A', 1000), sub('b', 'B', 2000)]);
    const mine = outline([sub('b', 'B', 2000)]);
    const theirs = outline([sub('a', 'A', 1000), sub('b', 'B saved elsewhere', 2000)]);
    const result = mergeOutline(base, mine, theirs);
    expect(result.collisions).toEqual([]);
    expect(result.outline.introduction[0].subPoints).toEqual([sub('b', 'B saved elsewhere', 2000)]);
  });

  it('keeps a point note and the independently added subpoint', () => {
    const result = mergeOutline(outline([]), outline([], { note: 'Local reminder' }), outline([sub('b', 'Saved subpoint')]));
    expect(result.collisions).toEqual([]);
    expect(result.outline.introduction[0]).toMatchObject({ note: 'Local reminder', subPoints: [sub('b', 'Saved subpoint')] });
  });

  it('does not silently capture a competing skeleton even when an older screen requests preferMine', async () => {
    const base = outline([sub('a', 'A', 1000), sub('b', 'B', 2000), sub('c', 'C', 3000)]);
    const mine = outline([sub('b', 'B', 1000), sub('a', 'A', 2000), sub('c', 'C', 3000)]);
    const theirs = outline([sub('a', 'A', 1000), sub('c', 'C', 2000), sub('b', 'B', 3000)]);
    let current = document(theirs);
    const before = JSON.parse(JSON.stringify(current)) as DocumentData;
    const writer = createEngineStructureWriter({ update: async updater => { current = updater(current)!; } }, 'outline-owner');
    await expect(writer.updateSermonOutline('sermon', mine, base, 'preferMine')).rejects.toMatchObject({ name: 'OutlineCollisionError' });
    expect(current).toEqual(before);
  });

  it('does not silently capture a subpoint with two different homes', async () => {
    const base = outline([sub('a')]);
    const mine: SermonOutline = { ...outline([]), main: [{ id: 'q', text: 'Q', subPoints: [sub('a')] }] };
    const theirs: SermonOutline = { ...outline([]), conclusion: [{ id: 'r', text: 'R', subPoints: [sub('a')] }] };
    let current = document(theirs);
    const before = JSON.parse(JSON.stringify(current)) as DocumentData;
    const writer = createEngineStructureWriter({ update: async updater => { current = updater(current)!; } }, 'outline-owner');
    await expect(writer.updateSermonOutline('sermon', mine, base, 'preferMine')).rejects.toMatchObject({ name: 'OutlineCollisionError' });
    expect(current).toEqual(before);
  });

  it('retains the existing default refusal for different words on the same subpoint', async () => {
    const base = outline([sub('a', 'Original')]), mine = outline([sub('a', 'Local')]), theirs = outline([sub('a', 'Saved')]);
    let current = document(theirs);
    const writer = createEngineStructureWriter({ update: async updater => { current = updater(current)!; } }, 'outline-owner');
    await expect(writer.updateSermonOutline('sermon', mine, base)).rejects.toMatchObject({ name: 'OutlineCollisionError' });
    expect(current).toEqual(document(theirs));
  });

  it('keeps an already saved addition when this screen did not change the point', () => {
    const base = outline([]), theirs = outline([sub('b', 'Saved words')]);
    const result = mergeOutline(base, base, theirs);
    expect(result.collisions).toEqual([]);
    expect(result.outline).toEqual(theirs);
  });
  it('keeps a deletion against an edit of that same subpoint as a question', () => {
    const base = outline([sub('a', 'Original')]);
    const result = mergeOutline(base, outline([]), outline([sub('a', 'Changed after opening')]));
    expect(result.collisions).toEqual(['p']);
  });

  it('treats different first words under the same new identity as a question', () => {
    const result = mergeOutline(outline([]), outline([sub('same', 'Local')]), outline([sub('same', 'Saved')]));
    expect(result.collisions).toEqual(['p']);
  });

  it('does not guess an order for malformed legacy positions', () => {
    const base = outline([sub('a', 'Original')]);
    const malformed = { id: 'b', text: 'Unknown position' } as SubPoint;
    const result = mergeOutline(base, outline([sub('a'), malformed]), outline([sub('a', 'Saved words')]));
    expect(result.collisions).toEqual(['p']);
  });

  it('retains the effective input ancestor with the refused comparison', async () => {
    const base = outline([sub('a', 'Opening')]), predecessor = outline([sub('a', 'Earlier own input')]);
    const mine = outline([sub('a', 'Current own words')]), theirs = outline([sub('a', 'Saved words')]);
    let current = document(theirs);
    const retain = jest.fn();
    const writer = createEngineStructureWriter({ update: async updater => { current = updater(current)!; } }, 'outline-owner', retain);
    await expect(writer.updateSermonOutline('sermon', mine, base, 'preferMine', { apply: (_base, _input, edit) => edit(predecessor) }))
      .rejects.toMatchObject({ baseline: { outline: predecessor } });
    expect(retain).toHaveBeenCalledWith(mine, predecessor, theirs);
    expect(current).toEqual(document(theirs));
  });

  it('retains an earlier refusal even after a later input has become the visible accepted save', async () => {
    const base = outline([sub('a', 'Opening')]), theirs = outline([sub('a', 'Saved words')]);
    let current = document(theirs), attempt = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const retain = jest.fn(), failed = jest.fn();
    const writer = createEngineStructureWriter({ update: async updater => {
      const first = attempt++ === 0;
      try { current = updater(current)!; } catch (error) { if (first) await held; throw error; }
    } }, 'outline-owner', retain);
    const capture = new OutlineCapture(writer, 'sermon', 'preferMine');
    capture.schedule({ outline: outline([sub('a', 'Earlier refused words')]), base, begin: () => ({ stored: jest.fn(), failed }) });
    const later = { ...base, conclusion: [{ id: 'later', text: 'Independent later point' }] };
    capture.schedule({ outline: later, base, begin: () => ({ stored: jest.fn(), failed }) });
    await Promise.resolve();release();await capture.flush();
    expect(failed).not.toHaveBeenCalled();
    expect(retain).toHaveBeenCalledTimes(1);
    expect(retain.mock.calls[0][0].introduction[0].subPoints[0].text).toBe('Earlier refused words');
    expect((current.outline as unknown as SermonOutline).conclusion).toEqual(later.conclusion);
  });

});
