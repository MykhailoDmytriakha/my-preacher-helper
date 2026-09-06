jest.unmock('react-markdown');
jest.unmock('remark-gfm');

import { render, screen } from '@testing-library/react';
import { Document, Packer } from 'docx';
import JSZip from 'jszip';
import React from 'react';

import FullPlanContent from '@/(pages)/(private)/sermons/[id]/plan/FullPlanContent';
import PlanMarkdown from '@/components/plan/PlanMarkdown';
import { planMarkdownToPlainText } from '@/utils/planHierarchy';

import { parseMarkdownToParagraphs } from '../../utils/wordExport';

const markdown = `## Parent

Parent text

### First child

**Child thesis**

- Child bullet

*John 3:16: Child verse*

> Child quote

### Second child

Sibling text

## Next parent

Next parent text`;

describe('plan heading ownership across reading and exports', () => {
  it('preserves indentation in TXT without adding code-block whitespace to Markdown', () => {
    const plain = planMarkdownToPlainText(markdown);
    expect(plain).toContain('\n  Parent text');
    expect(plain).toContain('\n  First child');
    expect(plain).toContain('\n    Child thesis');
    expect(plain).toContain('\n    - Child bullet');
    expect(plain).toContain('\n    John 3:16: Child verse');
    expect(plain).toContain('\n    Child quote');
    expect(plain).toContain('\nNext parent\n\n  Next parent text');
    expect(planMarkdownToPlainText('')).toBe('');
    expect(planMarkdownToPlainText('**Intro** with [link](https://example.com)<br>Next')).toBe('Intro with link (https://example.com)\nNext');
  });

  it('resolves references and footnotes across headings and body boundaries', () => {
    render(<PlanMarkdown markdown={'## [Parent][john]\n\nSee [verse][john] and a note[^first].\n\n### Child\n\nOther text.\n\n[john]: https://example.com/john\n[^first]: Shared footnote'} />);
    expect(screen.getByRole('link', { name: 'Parent' })).toHaveAttribute('href', 'https://example.com/john');
    expect(screen.getByRole('link', { name: 'verse' })).toHaveAttribute('href', 'https://example.com/john');
    const footnoteLink = screen.getByRole('link', { name: '1' });
    expect(footnoteLink).toHaveAttribute('href', '#user-content-fn-first');
    expect(document.getElementById('user-content-fn-first')).toHaveTextContent('Shared footnote');
  });

  it('keeps tables, nested lists and fenced heading text within the PDF renderer body', () => {
    render(<PlanMarkdown markdown={'## Parent\n\n### Child\n\n- Outer\n  - Nested\n\n| A | B |\n| - | - |\n| One | Two |\n\n```text\n## Not a heading\n```\n\nLast paragraph\n\n#### Deeper\n\nDeep text'} />);
    const body = screen.getByText('Last paragraph').closest('[data-plan-body-level]');
    expect(body).toHaveStyle({ paddingInlineStart: '3rem' });
    expect(body).toContainElement(screen.getByRole('table'));
    expect(body).toContainElement(screen.getByText('Nested'));
    expect(body).toContainElement(screen.getByText('## Not a heading'));
    expect(screen.queryByRole('heading', {name:'Not a heading'})).not.toBeInTheDocument();
    expect(screen.getByText('Deep text').closest('[data-plan-body-level]')).toHaveStyle({paddingInlineStart:'4.5rem'});
    expect(planMarkdownToPlainText('### Child\n\n- Outer\n  - Nested')).toContain('\n      - Nested');
  });

  it('keeps every child block in one indented body and resets for the next parent', () => {
    render(<FullPlanContent combinedPlan={{ introduction: '', main: markdown, conclusion: '' }} t={key => key} noContentText="Empty" />);
    const child = screen.getByText('Child thesis').closest('[data-plan-body-level]');
    expect(child).toHaveStyle({ paddingInlineStart: '3rem' });
    for (const text of ['Child bullet', 'John 3:16: Child verse', 'Child quote']) {
      expect(child).toContainElement(screen.getByText(text));
    }
    expect(child).not.toContainElement(screen.getByText('Sibling text'));
    expect(screen.getByText('Sibling text').closest('[data-plan-body-level]')).toHaveStyle({ paddingInlineStart: '3rem' });
    expect(screen.getByText('Next parent text').closest('[data-plan-body-level]')).toHaveStyle({ paddingInlineStart: '1.5rem' });
  });

  it('serializes the same parent and child distinction in real Word paragraphs', async () => {
    const document = new Document({ sections: [{ children: parseMarkdownToParagraphs(markdown) }] });
    const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
    const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
    const paragraphs = Array.from(xml.getElementsByTagName('w:p'));
    const indent = (text: string) => Number(paragraphs.find(p => p.textContent?.includes(text))?.getElementsByTagName('w:ind')[0]?.getAttribute('w:left') ?? 0);
    expect(indent('Child thesis')).toBe(720);
    expect(indent('Child bullet')).toBeGreaterThanOrEqual(indent('Child thesis'));
    expect(indent('John 3:16: Child verse')).toBe(720);
    expect(indent('Child quote')).toBeGreaterThanOrEqual(indent('Child thesis'));
    expect(indent('Sibling text')).toBe(720);
    expect(indent('Next parent text')).toBe(360);
  });
});
