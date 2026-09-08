import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

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
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
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

    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));

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

    await screen.findByText('Plain Content');
    const copyBtn = screen.getByRole('button', { name: 'Copy' });
    expect(copyBtn).toBeEnabled();
    fireEvent.click(copyBtn);

    // Feedback toggles to Copied!
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Plain Content');
    });
  });
});


it('keeps the prepared text selectable when clipboard permission is denied', async () => {
  const writeText = jest.fn().mockRejectedValue(new Error('Denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  const report = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<ExportTxtModal isOpen onClose={jest.fn()} content="Prepared text" getContent={jest.fn()} />);
  await screen.findByText('Prepared text');
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(report).toHaveBeenCalledWith('Failed to copy text:', expect.any(Error)));
  expect(screen.getByText('Prepared text')).toBeInTheDocument();
  expect(screen.queryByText('Copied!')).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  report.mockRestore();
});
