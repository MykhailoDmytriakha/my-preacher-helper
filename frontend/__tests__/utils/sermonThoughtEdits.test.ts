import { nestPointUnderPoint, outdentSubPoint } from '@/utils/outlineDnd';
import { addSermonThought, replaceSermonOutline } from '@/utils/sermonThoughtEdits';
import { preservesSermonLinks } from '@/data-engine/sermonIntegrity';
import type { Sermon, SermonOutline } from '@/models/models';
import type { DocumentData } from '@/data-engine/types';
const a = { id: 'a', text: 'Keep A', date: 'today', tags: ['main', 'custom'], outlinePointId: 'p1', subPointId: 'sub' };
const b = { id: 'b', text: 'Keep B', date: 'today', tags: ['main'], outlinePointId: 'p2' };
const p1 = { id: 'p1', text: 'Point 1', subPoints: [{ id: 'sub', text: 'Sub', position: 0 }] }, p2 = { id: 'p2', text: 'Point 2' };
const outline: SermonOutline = { introduction: [], main: [p1, p2], conclusion: [] };
const original = { id: 'sermon', title: 'Keep title', verse: 'Romans 1', userId: 'owner', date: 'today', thoughts: [a, b], outline,
  structure: { introduction: [], main: ['a', 'b'], conclusion: [], ambiguous: [] } } as Sermon;
const valid = (next: Sermon) => expect(preservesSermonLinks(original as unknown as DocumentData, next as unknown as DocumentData)).toBe(true);

it('follows a moved subpoint and parent section in the same outline replacement', () => {
  const next = replaceSermonOutline(original, { introduction: [{ ...p2, subPoints: p1.subPoints }], main: [], conclusion: [] });
  expect(next.thoughts).toEqual([{ ...a, outlinePointId: 'p2', subPointId: 'sub', tags: ['custom', 'intro'] }, { ...b, tags: ['intro'] }]);
  expect(next.structure).toMatchObject({ introduction: ['a', 'b'], main: [] }); expect(next.thoughtsBySection).toEqual(next.structure); valid(next);
});

it('clears only the removed point or subpoint and keeps every thought text', () => {
  const deletedPoint = replaceSermonOutline(original, { ...outline, main: [p2] });
  expect(deletedPoint.thoughts).toEqual([{ ...a, outlinePointId: null, subPointId: null }, b]); valid(deletedPoint);
  const deletedSub = replaceSermonOutline(original, { ...outline, main: [{ id: 'p1', text: 'Keep point' }, p2] });
  expect(deletedSub.thoughts).toEqual([{ ...a, subPointId: null }, b]); valid(deletedSub);
});

it('keeps unchanged assignments and does not silently rewrite unrelated legacy orphans', () => {
  const orphan = { ...a, id: 'orphan', outlinePointId: 'missing', subPointId: 'missing-sub' };
  const existing = { ...original, thoughts: [a, b, orphan] };
  const next = replaceSermonOutline(existing, { ...outline, main: [{ ...p1, text: 'Renamed' }, p2] });
  expect(next.thoughts).toEqual(existing.thoughts); expect(next.structure).toBe(existing.structure);
  expect(next.title).toBe(existing.title);
  const empty = replaceSermonOutline({ title: 'Old partial document' } as Sermon, outline);
  expect(empty).toEqual({ title: 'Old partial document', outline });
});

it('deduplicates an identical thought identity but refuses a different payload with that ID', () => {
  expect(addSermonThought(original, a)).toBe(original);
  expect(() => addSermonThought(original, { ...a, text: 'Other operation' })).toThrow('already uses this ID');
  expect(original.thoughts).toEqual([a, b]);
});

it('keeps thought identity attached when a point becomes a subpoint', () => {
  const direct = { ...a, id: 'direct', subPointId: null };
  const input = { ...original, thoughts: [a, b, direct] };
  const next = replaceSermonOutline(input, nestPointUnderPoint(outline, 'p1', 'p2'));
  expect(next.thoughts).toEqual([{ ...a, outlinePointId: 'p2' }, b, { ...direct, outlinePointId: 'p2', subPointId: 'p1' }]);
});

it('follows a promoted subpoint into its new section', () => {
  const next = replaceSermonOutline(original, outdentSubPoint(outline, 'sub', 'introduction', 0));
  expect(next.thoughts).toEqual([{ ...a, outlinePointId: 'sub', subPointId: null, tags: ['custom', 'intro'] }, b]);
  expect(next.structure).toMatchObject({ introduction: ['a'], main: ['b'] }); valid(next);
});
