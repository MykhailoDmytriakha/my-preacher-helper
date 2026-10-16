import { buildSharedNotePreview } from '@/utils/sharedNotePreview';
import { countWords, measureNoteForCut } from '@/utils/noteCutCorridor';
import { splitMarkdownSections } from '@/utils/markdownSections';
import { normalizePlanPointHeadings } from '@/utils/markdownUtils';
import { splitNoteIntoSections } from '@/utils/noteSections';

const words = { note: 'Note', question: 'Question', untitled: 'Untitled' };
const preview = (content: string) => buildSharedNotePreview(
  { title: 'A note', content, scriptureRefs: [], type: 'note' }, 'en', words,
).description;

const blocks = [
  ['long backtick fence', '````\n```\n# Inside code\n```\n````'],
  ['tilde fence', '~~~~\n~~~\n# Inside code\n~~~\n~~~~'],
  ['quoted fence', '> ````\n> ```\n> # Inside code\n> ```\n> ````'],
  ['list fence', '- ```\n  # Inside code\n  ```'],
  ['quote inside list', '- > ```\n  > code\n  > ```'],
  ['tab after quote marker', '>\t```\n> code\n> ```'],
  ['indented code', '    # Inside code\n    code'],
] as const;

describe('Markdown code readers (BUG-20261006-fence-readers-miss-long-and-quoted-fences)', () => {
  it.each(blocks)('omits %s from previews and measurements without losing later prose', (_name, block) => {
    const content = `Before\n\n${block}\n\nAfter`;
    expect(preview(content)).toBe('Before. After');
    expect(measureNoteForCut(content)).toEqual({ words: 2, paragraphs: 2, corridor: { min: 1, max: 2 } });
  });

  it('does not expose code as an unnamed note title', () => {
    expect(buildSharedNotePreview({ content: '> ~~~\n> Hidden\n> ~~~\n\nVisible', scriptureRefs: [], type: 'note' }, 'en', words).title).toBe('Visible');
  });

  it('keeps inline code visible in previews but excludes it from word counts', () => {
    const content = 'Before ``inline ` code`` after';
    expect(preview(content)).toBe('Before inline code after');
    expect(countWords(content)).toBe(2);
  });

  it('does not mistake an unmatched longer inline delimiter for an opener', () => {
    expect(countWords('`` alpha beta` code` tail')).toBe(3);
  });

  it('keeps escaped backticks as prose', () => {
    expect(countWords('Before \\`visible words\\` after')).toBe(4);
  });

  it('handles large unmatched delimiter runs without removing their prose', () => {
    const content = `Before ${'`'.repeat(8000)} ${'x'.repeat(100000)}`;
    expect(countWords(content)).toBe(2);
  });

  const headingCases = [
    ['mixed line endings', '# First\n```\rinside\r```\n# Real:', ['First', 'Real:']],
    ['unclosed list fence', '- item\n\n  ```\n  # Fake\n# Real:', ['Real:']],
    ['thematic break before an indented fence', '- - -\n  ```\ncode\n# Fake:\n```\n# Real:', ['Real:']],
    ['empty list item followed by a blank line', '-\n\n  ```\n  code\n# Fake:', []],
    ['indented list code followed by prose', '- item\n\n      ~~~\n      code\n  prose\n# Real:', ['Real:']],
    ['lazy list continuation', '- item\nlazy\n  ```\n  code\n# Real:', ['Real:']],
    ['empty marker padding', '-    \n  ```\n  code\n# Real:', ['Real:']],
  ] as const;

  it.each(headingCases)('reads headings after %s consistently', (_name, content, expected) => {
    expect(splitMarkdownSections(content).sections.map(section => section.headingText)).toEqual(expected);
    expect(splitNoteIntoSections(content).filter(section => section.heading).map(section => section.heading)).toEqual(expected);
    const normalized = normalizePlanPointHeadings(content);
    expect(normalized).toBe(expected.length ? content.replace('# Real:', '# Real') : content);
  });

  it('keeps prose after indented code in a list', () => {
    expect(countWords('- item\n\n      ~~~\n      code\n  prose\n# Real')).toBe(3);
  });

  it('retains indented code syntax when preparing a cut section', () => {
    const sections = splitNoteIntoSections('    Code words\n\n# Real\nProse');
    expect(sections[0].text).toBe('    Code words');
    expect(sections[0].words).toBe(0);
    expect(sections[1].words).toBe(2);
  });

  it('preserves Unicode prose and Windows line endings around quoted code', () => {
    const content = '🙂 Before\r\n\r\n> ~~~\r\n> # Hidden\r\n> ~~~\r\n\r\nAfter';
    expect(preview(content)).toBe('🙂 Before. After');
    expect(measureNoteForCut(content)).toEqual({ words: 2, paragraphs: 2, corridor: { min: 1, max: 2 } });
  });

  it('excludes inline spans that continue on the next line', () => {
    expect(countWords('Before `hidden\nwords` after')).toBe(2);
  });

  it('does not remove literal fence-like text inside an inline span', () => {
    expect(countWords('Before `` ``` literal ``` `` after')).toBe(2);
  });
});
