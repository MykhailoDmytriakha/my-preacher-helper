import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ExportTxtModal } from '@/components/ExportButtons';

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

// Mock react-dom createPortal to render inline for tests
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: any) => node,
}));

describe('ExportTxtModal', () => {
  const getContent = jest.fn(async (format: 'plain' | 'markdown') =>
    format === 'plain' ? 'Plain Content' : '# Title\n\n**Bold**'
  );

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(void 0) },
    });
  });

  it('loads and shows plain content by default', async () => {
    render(
      <ExportTxtModal
        isOpen
        onClose={() => undefined}
        getContent={getContent}
        format="plain"
      />
    );

    // Content fetched
    await waitFor(() => expect(getContent).toHaveBeenCalled());
    expect(screen.getByText('Plain Content')).toBeInTheDocument();
  });

  it('switches to markdown and renders sanitized markdown', async () => {
    render(
      <ExportTxtModal
        isOpen
        onClose={() => undefined}
        getContent={getContent}
        format="plain"
      />
    );

    await waitFor(() => expect(getContent).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'export.formatMarkdown' }));

    // Should fetch again for markdown format
    await waitFor(() => expect(getContent).toHaveBeenCalledTimes(2));
    // ReactMarkdown is mocked globally; assert the rendered markdown block includes the content
    const md = screen.getByTestId('markdown');
    expect(md.textContent || '').toContain('Title');
  });

  it('copies to clipboard and shows Copied! feedback', async () => {
    render(
      <ExportTxtModal
        isOpen
        onClose={() => undefined}
        getContent={getContent}
        format="plain"
      />
    );

    await waitFor(() => expect(getContent).toHaveBeenCalled());

    const copyBtn = screen.getByRole('button', { name: 'Copy' });
    fireEvent.click(copyBtn);

    // Feedback toggles to Copied!
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });
});
