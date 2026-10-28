// Runs against the REAL react-markdown, not the global stub in jest.setup.js — the point is the element
// a GFM table is rendered into (see app/components/ui/__tests__/FoldableMarkdown.rendered.test.tsx).
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { render, screen } from '@testing-library/react';

import MarkdownDisplay from '@components/MarkdownDisplay';

it('puts a table into its own horizontally scrolling box, so a long cell cannot widen the page', () => {
  // A table sizes its columns by their longest word: a pasted link in a cell stretched the group page
  // past an iPad screen (BUG-20261010-group-long-note-pushes-start-off-screen, Codex review).
  const link = `https://example.com/${'x'.repeat(200)}`;
  render(<MarkdownDisplay content={`| Passage | Link |\n| --- | --- |\n| John 3 | ${link} |`} />);

  const table = screen.getByRole('table');
  expect(screen.getByText(link).closest('table')).toBe(table);
  expect(table.parentElement).toHaveClass('max-w-full', 'overflow-x-auto');
});


describe('structured callouts are prose, while real code keeps its formatting', () => {
  it.each(['Illustration', 'Application', 'Question', 'Quote', 'Definition'])(
    'renders %s as prose without a code ancestor and retains authored line breaks',
    (type) => {
      const words = 'First line with  two spaces.\nSecond line stays separate.';
      const { container } = render(<MarkdownDisplay content={`[${type}: ${words}]`} />);
      const callout = container.querySelector('.markdown-callout');

      expect(callout).not.toBeNull();
      expect(callout?.textContent).toContain(words);
      // A prose callout must not inherit the code container's no-wrap semantics.
      expect(callout?.closest('pre, code')).toBeNull();
    },
  );

  it('keeps a genuine fenced code block and every space and line break in its words', () => {
    const code = 'const value = "first  second";\n  const next = value;';
    const { container } = render(<MarkdownDisplay content={`\`\`\`javascript\n${code}\n\`\`\``} />);
    const rendered = container.querySelector('pre > code.language-javascript');

    expect(rendered?.textContent).toBe(`${code}\n`);
    expect(container.querySelector('.markdown-callout')).toBeNull();
  });

  it('leaves an unrecognized fence as code and inline code inside its paragraph', () => {
    const { container } = render(<MarkdownDisplay content={'```unknown\nfirst  second\n```\n\nUse `value  here` in a sentence.'} />);

    expect(container.querySelector('pre > code.language-unknown')?.textContent).toBe('first  second\n');
    expect(container.querySelector('p > code')?.textContent).toBe('value  here');
    expect(container.querySelector('.markdown-callout')).toBeNull();
  });
});


it('allows a long search match to wrap within structured prose without losing its words', () => {
  const word = 'longmatchedword'.repeat(16);
  render(<MarkdownDisplay content={`[Quote: Read ${word} carefully.]`} searchQuery={word} />);

  const mark = screen.getByText(word, { selector: 'mark' });
  expect(mark.textContent).toBe(word);
  expect(mark).toHaveStyle({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
});
