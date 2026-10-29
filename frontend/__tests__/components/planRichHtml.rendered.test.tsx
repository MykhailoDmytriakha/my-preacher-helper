jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { render, screen } from '@testing-library/react';
import React from 'react';

import MarkdownDisplay from '@/components/MarkdownDisplay';
import PlanMarkdown from '@/components/plan/PlanMarkdown';
import PlanSectionDialog from '@/components/plan/PlanSectionDialog';

const readers = [
  ['plan', (text: string) => <PlanMarkdown markdown={text} />],
  ['section', (text: string) => <PlanSectionDialog section="main" markdown={text} onClose={() => {}} />],
  ['note', (text: string) => <MarkdownDisplay content={text} />],
] as const;

describe.each(readers)('safe rich Markdown in the %s reader', (_name, reader) => {
  it('renders authored underline and nested bold instead of literal formatting tags', () => {
    const { baseElement } = render(reader('Read **<u>Authored underline</u>** carefully.'));
    const underline = baseElement.querySelector('u');
    expect(underline).toHaveTextContent('Authored underline');
    expect(underline?.closest('strong')).not.toBeNull();
    expect(baseElement.textContent).not.toContain('<u>Authored underline</u>');
  });

  it('renders a canonical HTML table without splitting a literal pipe in a cell', () => {
    render(reader('<table><thead><tr><th>Passage</th><th>Words</th></tr></thead><tbody><tr><td>John 3:16</td><td><u>Grace | truth</u></td></tr></tbody></table>'));
    const table = screen.getByRole('table');
    expect(table.querySelectorAll('tbody td')).toHaveLength(2);
    expect(table.querySelector('u')).toHaveTextContent('Grace | truth');
  });

  it('removes scripts, event handlers, unsafe URLs and unclobbered global names', () => {
    const { baseElement } = render(reader('<h2 id="location">Safe heading</h2><a name="history" href="javascript:alert(1)" onclick="alert(1)">Safe words</a><script>evil()</script><iframe src="javascript:alert(1)"></iframe>'));
    expect(baseElement.querySelector('script, iframe, [onclick], [onerror], [href^="javascript:"], #location, [name="history"]')).toBeNull();
    expect(baseElement.textContent).toContain('Safe words');
  });

  it('keeps authored HTML-looking code literal and preserves ordinary Markdown', () => {
    const { baseElement } = render(reader('Keep `<u>code sample</u>` and **bold words**.\n\n```html\n<u>block sample</u>\n```'));
    expect(baseElement.querySelector('p > code')).toHaveTextContent('<u>code sample</u>');
    expect(baseElement.querySelector('pre > code')?.textContent).toBe('<u>block sample</u>\n');
    expect(baseElement.querySelector('strong')).toHaveTextContent('bold words');
    expect(baseElement.querySelector('u')).toBeNull();
  });

  it('links an authored fragment to its safe namespace and leaves outside URLs intact', () => {
    render(reader('<h2 id="location">Authored target</h2>\n\n[Jump](#location) and [Outside](https://example.com/).'));
    const jump = screen.getByRole('link', { name: 'Jump' });
    const id = jump.getAttribute('href')!.slice(1);
    expect(id).toMatch(/^user-content-/);
    expect(document.getElementById(id)).toHaveTextContent('Authored target');
    expect(screen.getByRole('link', { name: 'Outside' })).toHaveAttribute('href', 'https://example.com/');
  });

  it('keeps the same footnote label in two reading cards independently addressable', () => {
    const { baseElement } = render(<>
      {reader('First card[^same].\n\n[^same]: First source words.')}
      {reader('Second card[^same].\n\n[^same]: Second source words.')}
    </>);
    const [first, second] = [...baseElement.querySelectorAll<HTMLAnchorElement>('a[data-footnote-ref]')];
    expect(first.hash).not.toBe(second.hash);
    expect(document.getElementById(decodeURIComponent(first.hash.slice(1)))).toHaveTextContent('First source words.');
    expect(document.getElementById(decodeURIComponent(second.hash.slice(1)))).toHaveTextContent('Second source words.');
  });

  it('keeps both directions of a footnote linked to real safe targets', () => {
    const { baseElement } = render(reader('Read this note[^first].\n\n[^first]: The retained footnote.'));
    const links = [...baseElement.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      expect(target).not.toBeNull();
      expect(target?.id).toMatch(/^user-content-/);
      expect(link).not.toHaveAttribute('target', '_blank');
    }
  });
});
