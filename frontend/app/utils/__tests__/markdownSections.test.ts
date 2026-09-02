import {
  collectSectionIds,
  findSectionIdsMatching,
  hasSections,
  splitMarkdownSections,
} from '@/utils/markdownSections';

describe('splitMarkdownSections', () => {
  it('returns an empty outline for empty input', () => {
    expect(splitMarkdownSections('')).toEqual({ intro: '', sections: [] });
  });

  it('keeps a note without headings entirely as intro', () => {
    const outline = splitMarkdownSections('Just a paragraph.\n\nAnd another one.');

    expect(outline.sections).toHaveLength(0);
    expect(hasSections(outline)).toBe(false);
    expect(outline.intro).toBe('Just a paragraph.\n\nAnd another one.');
  });

  it('keeps text written before the first heading as intro', () => {
    const outline = splitMarkdownSections('Opening line.\n\n# Title\n\nUnder the title.');

    expect(outline.intro).toBe('Opening line.');
    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0].body).toBe('Under the title.');
  });

  it('nests h2 under h1 and h3 under h2', () => {
    const outline = splitMarkdownSections(
      ['# One', 'one body', '## Two', 'two body', '### Three', 'three body'].join('\n')
    );

    const [one] = outline.sections;
    expect(one.level).toBe(1);
    expect(one.headingText).toBe('One');
    expect(one.body).toBe('one body');

    const [two] = one.children;
    expect(two.level).toBe(2);
    expect(two.body).toBe('two body');

    const [three] = two.children;
    expect(three.level).toBe(3);
    expect(three.headingText).toBe('Three');
    expect(three.body).toBe('three body');
    expect(three.children).toHaveLength(0);
  });

  it('nests under the nearest lower level when a level is skipped', () => {
    const outline = splitMarkdownSections('# One\n\n### Deep\n\ndeep body');

    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0].children).toHaveLength(1);
    expect(outline.sections[0].children[0].level).toBe(3);
  });

  it('closes deep sections when a higher level comes back', () => {
    const outline = splitMarkdownSections(
      ['# One', '## Two', '### Three', '# Four', 'four body'].join('\n')
    );

    expect(outline.sections).toHaveLength(2);
    expect(outline.sections[1].headingText).toBe('Four');
    expect(outline.sections[1].body).toBe('four body');
    expect(outline.sections[1].children).toHaveLength(0);
  });

  it('treats sibling headings of the same level as siblings, not as nesting', () => {
    const outline = splitMarkdownSections('## A\na\n## B\nb');

    expect(outline.sections).toHaveLength(2);
    expect(outline.sections.map((s) => s.headingText)).toEqual(['A', 'B']);
  });

  it('does not read a hash inside a fenced code block as a heading', () => {
    const outline = splitMarkdownSections(
      ['# Real', '```bash', '# not a heading', 'echo hi', '```', 'after'].join('\n')
    );

    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0].children).toHaveLength(0);
    expect(outline.sections[0].body).toContain('# not a heading');
    expect(outline.sections[0].body).toContain('after');
  });

  it('keeps the raw heading line, and a plain-text version with no markdown left', () => {
    const outline = splitMarkdownSections('## **Bold** heading\nbody');

    expect(outline.sections[0].headingMarkdown).toBe('## **Bold** heading');
    // The outline panel and aria labels can only render plain text.
    expect(outline.sections[0].headingText).toBe('Bold heading');
  });

  it('strips italics, code, strikethrough and links from the plain-text heading', () => {
    const outline = splitMarkdownSections(
      ['# *Один*', '# `код`', '# ~~вычеркнуто~~', '# [Ссылка](https://example.com)'].join('\n')
    );

    expect(outline.sections.map((s) => s.headingText)).toEqual([
      'Один',
      'код',
      'вычеркнуто',
      'Ссылка',
    ]);
  });

  it('ignores a lone hash with no text, which is not a heading', () => {
    const outline = splitMarkdownSections('#\n#hashtag\ntext');

    expect(outline.sections).toHaveLength(0);
    expect(outline.intro).toContain('#hashtag');
  });

  it('gives every section an id unique within the document', () => {
    const outline = splitMarkdownSections('# A\n## A1\n## A2\n# B\n## B1');
    const ids = collectSectionIds(outline.sections);

    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });
});

describe('findSectionIdsMatching', () => {
  const outline = splitMarkdownSections(
    ['# Outer', 'nothing here', '## Inner', 'the needle lives here', '# Other', 'plain'].join('\n')
  );

  it('returns nothing for an empty query', () => {
    expect(findSectionIdsMatching(outline.sections, '  ')).toEqual([]);
  });

  it('returns the matching section together with its ancestors', () => {
    const ids = findSectionIdsMatching(outline.sections, 'needle');
    const inner = outline.sections[0].children[0];

    expect(ids).toContain(inner.id);
    expect(ids).toContain(outline.sections[0].id);
    expect(ids).not.toContain(outline.sections[1].id);
  });

  it('matches the heading text as well as the body, case-insensitively', () => {
    expect(findSectionIdsMatching(outline.sections, 'INNER')).toContain(
      outline.sections[0].children[0].id
    );
  });
});
