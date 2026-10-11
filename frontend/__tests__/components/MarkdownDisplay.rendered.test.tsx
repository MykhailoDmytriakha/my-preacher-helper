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
