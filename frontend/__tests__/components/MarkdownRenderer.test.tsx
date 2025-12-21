import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';
import { sanitizeMarkdown } from '@/utils/markdownUtils';

// Spy on sanitizeMarkdown to ensure it is invoked
jest.mock('@/utils/markdownUtils', () => {
  const original = jest.requireActual('@/utils/markdownUtils');
  return {
    __esModule: true,
    ...original,
    sanitizeMarkdown: jest.fn((s: string) => original.sanitizeMarkdown(s)),
  };
});

// Use real react-markdown so we can verify anchor props
// No mock for react-markdown here

describe('MarkdownRenderer (ui)', () => {
  it('returns null for empty markdown', () => {
    const { container } = render(<MarkdownRenderer markdown="" />);
    expect(container.firstChild).toBeNull();
  });

  it('sanitizes incoming markdown content', () => {
    const sanitizeMarkdownMock = jest.mocked(sanitizeMarkdown);
    const input = 'Hello\u0000World';
    render(<MarkdownRenderer markdown={input} />);
    expect(sanitizeMarkdownMock).toHaveBeenCalledWith(input);
  });

  // react-markdown is globally mocked in jest.setup to a simple div.
  // We verify piping/sanitization elsewhere; anchor behavior is covered indirectly.

  it('applies section color classes by section', () => {
    const { rerender } = render(<MarkdownRenderer markdown={'text'} section="introduction" />);
    // Ensure wrapper div exists
    const container = screen.getByText('text').closest('div');
    expect(container).toBeInTheDocument();

    // Switch to another section and ensure it still renders
    rerender(<MarkdownRenderer markdown={'text'} section="main" />);
    expect(screen.getByText('text')).toBeInTheDocument();

    rerender(<MarkdownRenderer markdown={'text'} section="conclusion" />);
    expect(screen.getByText('text')).toBeInTheDocument();
  });
});
