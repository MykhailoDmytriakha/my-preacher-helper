import { buildExportSections } from '@/utils/exportContentModel';
import { exportSermon, exportThought, numberedExportSermon } from '@test-utils/exportFixtures';

it('builds language-independent outline blocks in visual order without changing the source', () => {
  const sermon = numberedExportSermon();
  const before = JSON.stringify(sermon);
  const sections = buildExportSections(sermon, 'mainPart');
  expect(sections).toEqual([{ key: 'main', blocks: [
    { type: 'outline', title: 'Main point', subPoints: [{ id: 'sub', text: 'Sub point', position: 2000 }], thoughts: ['before', 'sub', 'after'].map(id => sermon.thoughts!.find(thought => thought.id === id)) },
    { type: 'outline', title: 'Next point', subPoints: [], thoughts: [sermon.thoughts!.find(thought => thought.id === 'next')] },
  ] }]);
  expect(JSON.stringify(sermon)).toBe(before);
});

it('retains explicit loose structure order and appends dated orphans', () => {
  const sermon = exportSermon({
    thoughts: [exportThought('orphan', { tags: ['main'], date: '2020-01-01' }), exportThought('first', { tags: ['main'] }), exportThought('second', { tags: ['main'] })],
    structure: { introduction: [], main: ['second', 'missing', 'first'], conclusion: [] },
  });
  expect(buildExportSections(sermon, 'main')[0].blocks[0].thoughts.map(t => t.id)).toEqual(['second', 'first', 'orphan']);
});

it('groups multiple tags before loose thoughts, orders dates and leaves empty outlines out', () => {
  const sermon = exportSermon({
    thoughts: [exportThought('multi-new', { tags: ['intro', 'main'], date: '2026-01-02' }), exportThought('multi-old', { tags: ['intro', 'main'] }), exportThought('loose', { tags: ['main'] })],
    outline: { introduction: [], main: [{ id: 'empty', text: 'Empty outline' }], conclusion: [] },
  });
  const blocks = buildExportSections(sermon, 'main')[0].blocks;
  expect(blocks).toEqual([{ type: 'loose', label: 'unassignedThoughts', thoughts: [sermon.thoughts![2]] }]);
  expect(buildExportSections(sermon, 'ambiguous')[0].blocks[0].thoughts.map(t => t.id)).toEqual(['multi-old', 'multi-new']);
});

it('falls back to dates without an outline or explicit structure and ignores invalid focus', () => {
  const sermon = exportSermon({ thoughts: [exportThought('new', { tags: ['main'], date: '2026-01-02' }), exportThought('old', { tags: ['main'] })] });
  expect(buildExportSections(sermon, 'main')[0].blocks[0].thoughts.map(t => t.id)).toEqual(['old', 'new']);
  expect(buildExportSections(sermon, 'unknown')).toEqual([]);
  expect(buildExportSections({ ...sermon, title: ' ' })).toEqual([]);
  expect(buildExportSections(exportSermon())).toEqual([]);
});


it.each([
  { ids: ['first', 'second'], expected: ['first', 'second'] },
  { ids: ['second', 'first'], expected: ['second', 'first'] },
  { ids: ['second'], expected: ['second', 'first'] },
])('keeps explicit outline order $ids ahead of position/date orphans', ({ ids, expected }) => {
  const sermon = exportSermon({
    thoughts: [exportThought('first', { tags: ['intro'], outlinePointId: 'point', position: -100, date: '2020-01-01' }), exportThought('second', { tags: ['intro'], outlinePointId: 'point', position: 100 })],
    outline: { introduction: [{ id: 'point', text: 'Point' }], main: [], conclusion: [] },
    structure: { introduction: ids, main: [], conclusion: [] },
  });
  expect(buildExportSections(sermon, 'introduction')[0].blocks[0].thoughts.map(t => t.id)).toEqual(expected);
});
