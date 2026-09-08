import { getExportContent } from '@/utils/exportContent';
import { exportSermon, exportThought, numberedExportSermon } from '@test-utils/exportFixtures';

import type { Sermon, Thought } from '@/models/models';

it.each(['plain', 'markdown'] as const)('preserves the numbered hierarchy and canonical visual order in %s', async format => {
  const result = await getExportContent(numberedExportSermon(), undefined, { format });
  const headings = ['1. Intro point', '2. Main point', '2.1 Sub point', '3. Next point', '4. Conclusion point'];
  headings.forEach(heading => expect(result).toContain(heading));
  headings.slice(1).forEach((heading, i) => expect(result.indexOf(headings[i])).toBeLessThan(result.indexOf(heading)));
  expect(result.indexOf('- before')).toBeLessThan(result.indexOf('- Sub thought'));
  expect(result.indexOf('- Sub thought')).toBeLessThan(result.indexOf('- after'));
  expect(result).toContain(format === 'markdown' ? '#### 2.1 Sub point' : '   2.1 Sub point');
  expect(result).toContain(format === 'markdown' ? '- Sub thought\n  Continued\n\n  Paragraph' : '- Sub thought\n         Continued\n\n         Paragraph');
});

it.each(['main', 'mainPart'])('focuses %s, excludes other sections and restarts numbering', async focus => {
  const result = await getExportContent(numberedExportSermon(), focus, { includeMetadata: false });
  expect(result).toContain('1. Main point');
  expect(result).toContain('1.1 Sub point');
  expect(result).toContain('2. Next point');
  expect(result).not.toContain('Intro point');
  expect(result).not.toContain('Conclusion point');
  expect(result).not.toContain('Test sermon');
});

it('uses actual canonical tag aliases across languages and preserves author tags when requested', async () => {
  const sermon = exportSermon({ thoughts: [
    exportThought('Intro', { tags: ['Introduction'] }),
    exportThought('Main', { tags: ['Основная часть'] }),
    exportThought('Conclusion', { tags: ['Висновок'] }),
    exportThought('Other', { tags: ['custom'] }),
  ] });
  const result = await getExportContent(sermon, undefined, { format: 'markdown', includeTags: true, includeMetadata: false });
  expect(result).toContain('## tags.introduction\n\n1. Intro');
  expect(result).toContain('## tags.mainPart\n\n2. Main');
  expect(result).toContain('## tags.conclusion\n\n3. Conclusion');
  expect(result).toContain('## export.otherThoughts\n\n4. Other');
  expect(result).toContain('*export.tagsLabelОсновная часть*');
  expect(await getExportContent(sermon)).not.toContain('export.tagsLabel');
});

it('separates multi-tag thoughts, preserves outline assignment and labels loose thoughts', async () => {
  const sermon = numberedExportSermon();
  sermon.thoughts!.push(exportThought('Multiple', { tags: ['intro', 'main'] }), exportThought('Loose', { tags: ['main'] }));
  const result = await getExportContent(sermon);
  expect(result).toContain('export.multipleTagsThoughts:');
  expect(result).toContain('Multiple');
  expect(result).toContain('export.unassignedThoughts:');
  expect(result).toContain('Loose');
  expect(result).toContain('1. Intro point');
});

it.each(['plain', 'markdown'] as const)('exports the saved plan before a legacy draft in %s', async format => {
  const plan = { introduction: { outline: '**Saved intro**\n- First' }, main: { outline: '  ' }, conclusion: { outline: 'Saved conclusion' } };
  const draft = { introduction: { outline: 'Draft intro' }, main: { outline: '' }, conclusion: { outline: '' } };
  const sermon = exportSermon({ plan, draft });
  const result = await getExportContent(sermon, undefined, { type: 'plan', format });
  expect(result).toContain('Saved intro');
  expect(result).toContain('Saved conclusion');
  expect(result).not.toContain('Draft intro');
  expect(result).not.toContain('tags.mainPart');
  expect(result).toContain(format === 'markdown' ? '**Saved intro**' : 'Saved intro\n- First');
  expect(result).toContain(format === 'markdown' ? '---\n' : '---------------------\n');
  const fallback = await getExportContent({ ...sermon, plan: undefined }, undefined, { type: 'plan', format, includeMetadata: false });
  expect(fallback).toContain('Draft intro');
  expect(fallback).not.toContain('Test sermon');
});

it('reports a missing plan and handles empty or untitled thought documents', async () => {
  expect(await getExportContent(exportSermon(), undefined, { type: 'plan' })).toBe('export.noPlanAvailable');
  expect(await getExportContent(exportSermon({ title: '', verse: '' }), undefined, { includeMetadata: false })).toBe('');
  expect(await getExportContent(exportSermon())).toBe('export.sermonTitleTest sermon\nexport.scriptureText\nJohn 1:1\n\n');
  expect(await getExportContent(numberedExportSermon(), 'unknown', { includeMetadata: false })).toBe('');
});

it.each(['plain', 'markdown'] as const)('renders optional and multiline scripture consistently for thoughts and plan in %s', async format => {
  for (const type of ['thoughts', 'plan'] as const) {
    const base = exportSermon({ plan: { introduction: { outline: 'Plan' }, main: { outline: '' }, conclusion: { outline: '' } } });
    for (const verse of ['', '   ', '  \n  ']) expect(await getExportContent({ ...base, verse }, undefined, { type, format })).not.toContain('export.scriptureText');
    const result = await getExportContent({ ...base, verse: 'John 1:1\n\n  Verse text  ' }, undefined, { type, format });
    expect(result).toContain(format === 'markdown' ? '> John 1:1\n> \n> Verse text' : 'John 1:1\n\n  Verse text  ');
  }
});

it('retains legacy absent tags and dates without dropping their text', async () => {
  const thoughts = [undefined, null, []].map((tags, i) => exportThought(`Thought ${i}`, { tags: tags as Thought['tags'], date: [undefined, '', 'invalid-date'][i] as string }));
  const sermon: Sermon = exportSermon({ thoughts });
  const result = await getExportContent(sermon);
  thoughts.forEach(thought => expect(result).toContain(thought.text));
});
