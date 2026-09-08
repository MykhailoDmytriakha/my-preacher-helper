import {
  appendScratchPlacementToOutline, cloneSermonOutline, collectComposedScratchNoteIds,
  getComposeNoticeKey, getOutlineSignature, getScratchSignature, placementKey, remapPlacement,
  stripScratchMetadata, stripScratchMetadataWithIdMap,
} from '@/components/sermon/scratch/scratchBoardModel';

import type { ComposedPlanOutline } from '@/config/schemas/zod';
import type { ScratchNote } from '@/models/models';

let mockId = 0;
jest.mock('@/utils/clientId', () => ({ newClientId: () => `fresh-${++mockId}` }));
beforeEach(() => { mockId = 0; });
const outline = (): ComposedPlanOutline => ({
  introduction: [{ id: 'existing', text: 'Existing', note: ' Keep ', isReviewed: false }],
  main: [{ id: 'generated', text: 'Generated', scratchNoteId: 'note-one', source: 'ai', subPoints: [
    { id: 'sub', text: 'Sub', position: 2, note: ' Detail ', scratchNoteId: 'note-two', source: 'manual' },
    { id: 'kept-sub', text: 'Existing child', position: 3, note: ' ' },
  ] }], conclusion: [],
});

it('preserves existing IDs, remints scratch-derived IDs, strips only metadata, and keeps input untouched', () => {
  const source = outline();
  const original = JSON.stringify(source);
  const result = stripScratchMetadataWithIdMap(source);
  expect(result.outline).toEqual({
    introduction: [{ id: 'existing', text: 'Existing', note: 'Keep', isReviewed: false }],
    main: [{ id: 'fresh-1', text: 'Generated', subPoints: [
      { id: 'fresh-2', text: 'Sub', position: 2, note: 'Detail' },
      { id: 'kept-sub', text: 'Existing child', position: 3 },
    ] }], conclusion: [],
  });
  expect([...result.idMap]).toEqual([['existing', 'existing'], ['generated', 'fresh-1'], ['sub', 'fresh-2'], ['kept-sub', 'kept-sub']]);
  expect(JSON.stringify(source)).toBe(original);
  expect(collectComposedScratchNoteIds(source)).toEqual(new Set(['note-one', 'note-two']));
  expect(collectComposedScratchNoteIds(null)).toEqual(new Set());
  expect(remapPlacement({ pointId: 'generated', subPointId: 'sub' }, result.idMap)).toEqual({ pointId: 'fresh-1', subPointId: 'fresh-2' });
  expect(remapPlacement({ pointId: 'existing' })).toEqual({ pointId: 'existing' });
  expect(remapPlacement({ pointId: 'missing', subPointId: 'unknown' }, result.idMap)).toEqual({ pointId: 'missing', subPointId: 'unknown' });
  expect(stripScratchMetadata({ introduction: [], main: [], conclusion: [] })).toEqual({ introduction: [], main: [], conclusion: [] });
});

it('clones both hierarchy levels and appends notes additively only to valid targets', () => {
  const original = outline();
  const copy = cloneSermonOutline(original);
  expect(appendScratchPlacementToOutline(copy, { pointId: 'existing' }, ' Added ')).toBe(true);
  expect(copy.introduction[0].note).toBe('Keep\nAdded');
  expect(appendScratchPlacementToOutline(copy, { pointId: 'generated', subPointId: 'sub' }, ' Sub text ')).toBe(true);
  expect(copy.main[0].subPoints?.[0].note).toBe('Detail\nSub text');
  expect(appendScratchPlacementToOutline(copy, { pointId: 'generated' }, ' First note ')).toBe(true);
  expect(copy.main[0].note).toBe('First note');
  const stable = JSON.stringify(copy);
  for (const target of [{ pointId: 'missing' }, { pointId: 'generated', subPointId: 'missing' }]) expect(appendScratchPlacementToOutline(copy, target, 'Text')).toBe(false);
  expect(appendScratchPlacementToOutline(copy, { pointId: 'existing' }, '  ')).toBe(false);
  expect(JSON.stringify(copy)).toBe(stable);
  expect(original).toEqual(outline());
  expect(cloneSermonOutline()).toEqual({ introduction: [], main: [], conclusion: [] });
});

it('distinguishes note text, order and placement while ignoring unrelated note timestamps', () => {
  const notes: ScratchNote[] = [{ id: 'n1', text: 'First', createdAt: 'today' }, { id: 'n2', text: 'Second', section: 'main', createdAt: 'today' }];
  const signature = getScratchSignature(notes);
  expect(getScratchSignature(notes.map(note => ({ ...note, createdAt: 'tomorrow' })))).toBe(signature);
  expect(getScratchSignature([...notes].reverse())).not.toBe(signature);
  expect(getScratchSignature([{ ...notes[0], text: 'Changed' }, notes[1]])).not.toBe(signature);
  expect(getScratchSignature([{ ...notes[0], section: 'main' }, notes[1]])).not.toBe(signature);
  expect(getOutlineSignature()).toBe(getOutlineSignature({ introduction: [], main: [], conclusion: [] }));
  expect(getOutlineSignature(outline())).not.toBe(getOutlineSignature());
  expect(placementKey(null)).toBe('pool');
  expect(placementKey({ pointId: 'point' })).toBe('point:point');
  expect(placementKey({ pointId: 'point', subPointId: 'sub' })).toBe('sub:sub');
});

it.each(['ai', 'manual', 'mixed', 'empty'] as const)('describes %s composition from point and sub-point sources', kind => {
  const source = outline();
  if (kind === 'empty') { source.main = []; }
  if (kind === 'ai' || kind === 'manual') {
    source.main[0].source = kind;
    source.main[0].subPoints![0].source = kind;
  }
  expect(getComposeNoticeKey(source)).toBe(kind === 'ai' ? 'scratch.board.composeSuccessAllAi' : kind === 'manual' ? 'scratch.board.composeSuccessAllManual' : 'scratch.board.composeSuccessHybrid');
});
