jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { render } from '@testing-library/react';
import React from 'react';
import MarkdownDisplay from '@components/MarkdownDisplay';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const TYPES = ['Illustration', 'Application', 'Question', 'Quote', 'Definition'] as const;

describe('MarkdownDisplay structured callout boundaries', () => {
  it.each(TYPES)('renders a multiline %s callout without promoting its inner hash line', type => {
    const marker = `[${type}: first line\n## Inside ${type}\n  indented last line]`;
    const source = `# Real\n\nBefore.\n\n${marker}\n\n# Last\n\nFollowing body.`;
    const { container } = render(<MarkdownDisplay content={source} />);
    const callouts = [...container.querySelectorAll('.markdown-callout')];

    expect([...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(node => node.textContent)).toEqual(['Real', 'Last']);
    expect(callouts).toHaveLength(1);
    expect(callouts[0].textContent).toContain(`Inside ${type}`);
    expect(callouts[0].textContent).toContain('indented last line');
    expect(container.textContent).toContain('Following body.');
    expect(container.innerHTML).toContain('## Inside');
  });

  it('keeps single-line structured callout controls and ordinary formatting', () => {
    const source = [
      '# Real',
      'Ordinary **bold** and <u>underlined</u> paragraph.',
      ...TYPES.map(type => `[${type}: Single line ${type}.]`),
      '# Last',
      'Following body.',
    ].join('\n\n');
    const { container } = render(<MarkdownDisplay content={source} />);

    expect([...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(node => node.textContent)).toEqual(['Real', 'Last']);
    expect(container.querySelectorAll('.markdown-callout')).toHaveLength(TYPES.length);
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('u')).toHaveTextContent('underlined');
    expect(container.textContent).toContain('Following body.');
  });

  it('keeps callout-shaped source literal inside fenced, inline, indented and HTML code', () => {
    const fenced = '[Quote: fenced first line\n## Inside fenced code\nfenced last line]';
    const inline = '[Quote: inline code]';
    const indented = '[Quote: indented code]';
    const htmlCode = '[Quote: HTML code]';
    const source = [
      '# Real',
      '',
      '```text',
      fenced,
      '```',
      '',
      `Inline \`${inline}\` stays code.`,
      '',
      `    ${indented}`,
      `<code>${htmlCode}</code>`,
      '',
      '# Last',
      '',
      'Following body.',
    ].join('\n');
    const { container } = render(<MarkdownDisplay content={source} />);
    const codeText = [...container.querySelectorAll('code')].map(node => node.textContent ?? '');

    expect(container.querySelectorAll('.markdown-callout')).toHaveLength(0);
    for (const marker of [fenced, inline, indented, htmlCode]) {
      expect(codeText.some(value => value.includes(marker))).toBe(true);
    }
    expect([...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(node => node.textContent)).toEqual(['Real', 'Last']);
    expect(container.textContent).toContain('Following body.');
  });

  it('keeps escaped openers, link labels and destinations, and raw HTML attributes literal', () => {
    const source = `# Real\n\n\\[Quote: escaped opener]\n\n[Quote: link label](https://example.com/path?q=%5BQuote%3A%20destination%5D)\n\n<span title="[Quote: HTML title]">Visible text</span>\n\n# Last\n\nFollowing body.`;
    const { container } = render(<MarkdownDisplay content={source} />);

    expect(container.querySelectorAll('.markdown-callout')).toHaveLength(0);
    expect(container.textContent).toContain('[Quote: escaped opener]');
    const link = container.querySelector('a');
    expect(link).toHaveTextContent('Quote: link label');
    expect(link).toHaveAttribute('href', 'https://example.com/path?q=%5BQuote%3A%20destination%5D');
    expect(container.querySelector('span[title="[Quote: HTML title]"]')).toHaveTextContent('Visible text');
    expect([...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(node => node.textContent)).toEqual(['Real', 'Last']);
    expect(container.textContent).toContain('Following body.');
  });
  it('preserves an unencoded callout-shaped URL destination', () => {
    const { container } = render(<MarkdownDisplay content="[Destination](https://example.com/[Quote:url])" />);
    expect(container.querySelectorAll('.markdown-callout')).toHaveLength(0);
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://example.com/%5BQuote:url%5D');
    expect(container.querySelector('a')).toHaveTextContent('Destination');
  });

});
