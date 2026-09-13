import { renderPlanExport, renderThoughtExport, type ExportLabels } from '@/utils/exportContentRenderer';
import { exportSermon, exportThought } from '@test-utils/exportFixtures';

const labels: ExportLabels = { sermonTitle: 'Sermon: ', scriptureText: 'Scripture: ', tagsLabel: 'Tags: ', multipleTagsThoughts: 'Multiple', unassignedThoughts: 'Unassigned', noEntries: 'Empty', introduction: 'Intro', main: 'Main', conclusion: 'Conclusion', ambiguous: 'Other' };

it.each(['plain', 'markdown'] as const)('renders controlled labels, loose numbering and empty blocks in %s', format => {
  const text = renderThoughtExport(exportSermon(), [{ key: 'main', blocks: [
    { type: 'loose', label: 'unassignedThoughts', thoughts: [exportThought('First', { tags: ['custom'] }), exportThought('Second')] },
    { type: 'loose', label: 'multipleTagsThoughts', thoughts: [] },
  ] }], { format, includeTags: true, includeMetadata: false }, labels);
  expect(text).toContain('Unassigned');
  expect(text).toContain('1. First');
  expect(text).toContain('2. Second');
  expect(text).toContain('Tags: custom');
  expect(text).toContain(format === 'markdown' ? '_Empty_' : 'Empty');
  expect(text).not.toContain('Test sermon');
});

it('does not render a document for an absent plan and preserves the supplied language labels', () => {
  const options = { format: 'plain' as const, includeTags: false, includeMetadata: true };
  expect(renderPlanExport(exportSermon(), options, labels)).toBe('');
  expect(renderPlanExport(exportSermon({ plan: { introduction: { outline: 'Body' }, main: { outline: '' }, conclusion: { outline: '' } } }), options, labels))
    .toBe('Sermon: Test sermon\nScripture:\nJohn 1:1\n\nIntro:\n\nBody\n\n---------------------\n\n');
});

it('exports a plan kept in the CURRENT shape, where the assembled document is not stored', () => {
  /**
   * `planText` holds text per node and the whole document is assembled on read, so such a
   * sermon has neither `plan` nor `draft`. Reading storage for the document returned an empty
   * string: the file would have come out as a title page with nothing under it — which is what
   * the person would have got the moment the greyed-out Word button was enabled.
   */
  const sermon = exportSermon({
    outline: {
      introduction: [{ id: 'p1', text: 'Великое приобретение' }],
      main: [{ id: 'p2', text: 'Принцип полноты' }],
      conclusion: [{ id: 'p3', text: 'Так говорит Господь' }],
    },
    planText: { p1: '- Исав пренебрёг', p2: '- сосуд без масла', p3: '- внешний вид' },
  } as never);

  const text = renderPlanExport(sermon, { format: 'plain', includeTags: false, includeMetadata: true }, labels);

  expect(text).toContain('Исав пренебрёг');
  expect(text).toContain('сосуд без масла');
  expect(text).toContain('внешний вид');
  expect(text).toContain('Intro');
  expect(text).toContain('Conclusion');
});
