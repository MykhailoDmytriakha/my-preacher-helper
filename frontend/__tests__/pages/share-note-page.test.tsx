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
    i18n: { language: 'en' },
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

  it('shows the note title and passages above the text, as the link preview promised', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: 'Body',
        title: 'Faith that carries',
        scriptureRefs: [{ id: 'r1', book: 'Luke', chapter: 5, fromVerse: 17, toVerse: 26 }],
      }),
    });

    render(<SharedNotePage />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Faith that carries'));
    expect(screen.getByText('Luke 5:17-26')).toBeInTheDocument();
  });

  it('previews the first six passages and counts the rest instead of printing a wall of them', async () => {
    const scriptureRefs = Array.from({ length: 9 }, (_, index) => ({ id: `r${index}`, book: 'Psalms', chapter: index + 1 }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ content: 'Body', title: 'Psalms', scriptureRefs }),
    });

    render(<SharedNotePage />);

    await waitFor(() => expect(screen.getByText(/Psalms 6/)).toBeInTheDocument());
    expect(screen.queryByText(/Psalms 7/)).not.toBeInTheDocument();
    expect(screen.getByText(/shareNotes\.morePassages/)).toBeInTheDocument();
  });

  it('names an untitled note by its first passage, once, as the link card did', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        content: 'Body',
        scriptureRefs: [
          { id: 'r1', book: 'Luke', chapter: 5, fromVerse: 17, toVerse: 26 },
          { id: 'r2', book: 'John', chapter: 3, fromVerse: 16 },
        ],
      }),
    });

    render(<SharedNotePage />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Luke 5:17-26'));
    expect(screen.getAllByText(/Luke 5:17-26/)).toHaveLength(1);
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
  });

  it('shows no heading when the note has no title', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ content: 'Body', scriptureRefs: [] }),
    });

    render(<SharedNotePage />);

    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('Body'));
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
