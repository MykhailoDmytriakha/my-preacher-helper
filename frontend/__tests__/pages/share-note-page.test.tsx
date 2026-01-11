import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { useParams } from 'next/navigation';

import '@testing-library/jest-dom';
import SharedNotePage from '@/(pages)/share/notes/[token]/page';

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

jest.mock('@components/MarkdownDisplay', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

jest.mock('@components/navigation/ThemeModeToggle', () => ({
  __esModule: true,
  default: () => <div data-testid="theme-toggle" />,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockUseParams = useParams as jest.MockedFunction<typeof useParams>;

describe('SharedNotePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseParams.mockReturnValue({ token: 'token-1' });
  });

  it('shows loading state initially', () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ content: 'Hello' }),
    });

    render(<SharedNotePage />);

    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('does not fetch when token is missing', () => {
    mockUseParams.mockReturnValue({});

    render(<SharedNotePage />);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('renders not found state for 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    render(<SharedNotePage />);

    await waitFor(() => expect(screen.getByText('shareNotes.notFound')).toBeInTheDocument());
  });

  it('renders error state for non-404 errors', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    render(<SharedNotePage />);

    await waitFor(() => expect(screen.getByText('shareNotes.error')).toBeInTheDocument());
  });

  it('renders error state when request throws', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new Error('boom'));

    render(<SharedNotePage />);

    await waitFor(() => expect(screen.getByText('shareNotes.error')).toBeInTheDocument());
    errorSpy.mockRestore();
  });

  it('renders markdown content on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ content: '# Hello' }),
    });

    render(<SharedNotePage />);

    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# Hello'));
  });
});
