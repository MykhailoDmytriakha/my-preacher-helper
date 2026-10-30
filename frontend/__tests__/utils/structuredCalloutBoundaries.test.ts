import { findSectionByHeading, splitMarkdownSections } from '@/utils/markdownSections';
import { splitNoteIntoSections } from '@/utils/noteSections';

const TYPES = ['Illustration', 'Application', 'Question', 'Quote', 'Definition'] as const;

const flattenHeadings = (sections: ReturnType<typeof splitMarkdownSections>['sections']): string[] =>
  sections.flatMap(section => [section.headingText, ...flattenHeadings(section.children)]);

describe('structured callout source boundaries', () => {
  it.each(['\n', '\r\n', '\r'])('keeps every multiline callout out of the outline with %j line endings', newline => {
    const blocks = TYPES.map(type =>
      `[${type}: first line${newline}## Not a section — remains in block${newline}  indentation retained]`,
    );
    const body = ['Unicode: café, naïve, Ω.', ...blocks, 'Final body text.'].join(`${newline}${newline}`);
    const source = `# Real${newline}${newline}${body}${newline}${newline}# Last${newline}${newline}Following section remains readable.`;
    const outline = splitMarkdownSections(source, { preserveBodyWhitespace: true });
    const noteSections = splitNoteIntoSections(source);

    expect(flattenHeadings(outline.sections)).toEqual(['Real', 'Last']);
    expect(outline.sections[0].headingMarkdown).toBe('# Real');
    const lastHeadingStart = source.lastIndexOf('# Last');
    const firstBodyLineEnd = source.indexOf(newline, source.indexOf('# Real')) + newline.length;
    const expectedBody = source.slice(firstBodyLineEnd, lastHeadingStart).slice(0, -newline.length);
    expect(outline.sections[0].body).toBe(expectedBody);
    for (const block of blocks) {
      expect(outline.sections[0].body).toContain(block);
      expect(noteSections[0].text).toContain(block);
    }
    expect(outline.sections[0].body).toContain(`${newline}## Not a section — remains in block`);
    expect(outline.sections[0].body).toContain(`${newline}  indentation retained]`);
    expect(noteSections.map(section => section.heading)).toEqual(['Real', 'Last']);
    expect(noteSections[0].text).toContain('Unicode: café, naïve, Ω.');
    expect(noteSections[1].text).toContain('Following section remains readable.');
  });

  it('keeps multiple multiline callouts in the body and leaves following sections readable', () => {
    const source = [
      '# Real',
      'Before.',
      '[Quote: first line',
      '## Inside the quote',
      'last line]',
      '[Definition: another first line',
      '## Inside the definition',
      'another last line]',
      '# Last',
      'Following body.',
    ].join('\n');
    const outline = splitMarkdownSections(source);
    const sections = splitNoteIntoSections(source);

    expect(flattenHeadings(outline.sections)).toEqual(['Real', 'Last']);
    expect(outline.sections[0].body).toContain('[Quote: first line\n## Inside the quote\nlast line]');
    expect(outline.sections[0].body).toContain('[Definition: another first line\n## Inside the definition\nanother last line]');
    expect(outline.sections[1].body).toBe('Following body.');
    expect(sections.map(section => section.heading)).toEqual(['Real', 'Last']);
    expect(sections[1].text).toContain('Following body.');
  });

  it('moves an inline heading callout into the body and resolves the former source heading spelling', () => {
    const source = '# H [Quote: text]\n\n# Next\nBody';
    const outline = splitMarkdownSections(source);
    const [heading] = outline.sections;

    expect(heading.headingMarkdown).toBe('# H ');
    expect(heading.headingText).toBe('H');
    expect(heading.body).toBe('[Quote: text]');
    expect(`${heading.headingMarkdown}${heading.body}`).toBe('# H [Quote: text]');
    expect(findSectionByHeading(outline.sections, 'H [Quote: text]')).toBe(heading.id);
    expect(outline.sections[1].headingText).toBe('Next');
    expect(outline.sections[1].body).toBe('Body');
  });

  it('does not promote headings from standalone fenced or inline literal code', () => {
    const source = [
      '# Real',
      '```text',
      '[Quote: literal first line',
      '## Not a heading',
      'last line]',
      '```',
      'Inline `[Quote: inline]` remains literal.',
      '# Last',
      'Following body.',
    ].join('\n');
    const outline = splitMarkdownSections(source);
    const sections = splitNoteIntoSections(source);

    expect(flattenHeadings(outline.sections)).toEqual(['Real', 'Last']);
    expect(outline.sections[0].body).toContain('## Not a heading');
    expect(outline.sections[0].body).toContain('`[Quote: inline]`');
    expect(sections.map(section => section.heading)).toEqual(['Real', 'Last']);
  });
  it('rejects an old callout heading alias shared by a distinct current heading', () => {
    const outline = splitMarkdownSections('# H [Quote: text]\n\n# H \`[Quote: text]\`\nBody.');
    expect(findSectionByHeading(outline.sections, 'H [Quote: text]')).toBeNull();
    expect(findSectionByHeading(outline.sections, 'H')).toBe(outline.sections[0].id);
  });

});
