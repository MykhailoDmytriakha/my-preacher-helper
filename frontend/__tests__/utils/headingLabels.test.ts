import { findSectionByHeading } from '@/hooks/useMarkdownOutline';
import { findSectionIdsMatching, splitMarkdownSections } from '@/utils/markdownSections';
import { splitNoteIntoSections } from '@/utils/noteSections';

const cases = [
  ['## `**stars** <u>tag</u>`', '**stars** <u>tag</u>'],
  ['## ``tick ` **inside**``', 'tick ` **inside**'],
  ['## **Bold** and <u>Underlined</u> &amp; words', 'Bold and Underlined & words'],
  ['## A &amp;amp; B', 'A &amp; B'],
  [String.raw`## \*literal\* and \`tick\``, '*literal* and `tick`'],
  ['## Trailing hashes ###', 'Trailing hashes'],
  ['## [label](https://example.test/path "title")', 'label'],
  ['## Plain section', 'Plain section'],
  ['## `&amp; **x**`', '&amp; **x**'],
  ['## &lt;u&gt;foo_bar_baz', '<u>foo_bar_baz'],
  ['## C#', 'C#'],
];

describe('BUG-20261029-heading-label-code-markers-stripped', () => {
  it.each(cases)('keeps the reader meaning in outline labels: %s', (source, expected) => {
    const section = splitMarkdownSections(`${source}\nBody.`).sections[0];
    expect(section.headingText).toBe(expected);
    expect(section.headingMarkdown).toBe(source);
    expect(section.body).toBe('Body.');
  });
  it.each(cases)('keeps the same heading meaning in server cut sections: %s', (source, expected) => {
    const section = splitNoteIntoSections(`${source}\nBody.`)[0];
    expect(section.heading).toBe(expected);
    expect(section.text).toBe(`${source}\nBody.`);
  });
  it('finds literal punctuation in an outline search', () => {
    const outline = splitMarkdownSections('## `**stars**`\nBody.');
    expect(findSectionIdsMatching(outline.sections, '**stars**')).toEqual(['0']);
  });
  it('keeps an unambiguous historical cutter label navigable', () => {
    const outline = splitMarkdownSections('## `**stars**`\nBody.');
    expect(findSectionByHeading(outline.sections, 'stars')).toBe('0');
  });
  it('does not guess between a historical alias and a different current label', () => {
    const outline = splitMarkdownSections('## `**stars**`\nOne.\n## stars\nTwo.');
    expect(findSectionByHeading(outline.sections, 'stars')).toBeNull();
  });
  it('does not choose the first of duplicate heading identities', () => {
    const outline = splitMarkdownSections('## Same\nOne.\n## Same\nTwo.');
    expect(findSectionByHeading(outline.sections, 'Same')).toBeNull();
  });
});
