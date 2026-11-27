import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { useParams } from 'next/navigation';

import '@testing-library/jest-dom';
import SharedNotePage from '@/(pages)/share/notes/[token]/page';

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/share/notes/token-1',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: null, loading: false }) }));

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
    mockFetch.mockReset();
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

  it('uses one public request when the page remounts during the guest session check', async () => {
    let respond!: (response: unknown) => void;
    const pending = new Promise(resolve => { respond = resolve; });
    const json = jest.fn().mockResolvedValue({ content: 'The public words' });
    mockFetch.mockReturnValueOnce(pending).mockReturnValueOnce(pending);

    const first = render(<SharedNotePage />);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    first.unmount();
    render(<SharedNotePage />);
    const callsWhilePending = mockFetch.mock.calls.length;
    await act(async () => respond({ ok: true, json }));

    expect(await screen.findByTestId('markdown')).toHaveTextContent('The public words');
    expect(callsWhilePending).toBe(1);
    expect(json).toHaveBeenCalledTimes(1);
  });

  it('checks a public link again after a completed read so revocation is seen', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: 'First response' }) })
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const first = render(<SharedNotePage />);
    expect(await screen.findByTestId('markdown')).toHaveTextContent('First response');
    first.unmount();
    render(<SharedNotePage />);

    expect(await screen.findByText('shareNotes.notFound')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a late response for the first token out of the next public note', async () => {
    let firstResponse!: (response: unknown) => void;
    const firstRead = new Promise(resolve => { firstResponse = resolve; });
    mockFetch.mockReturnValueOnce(firstRead);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ content: 'Second note' }) });

    const { rerender } = render(<SharedNotePage />);
    mockUseParams.mockReturnValue({ token: 'token-2' });
    rerender(<SharedNotePage />);
    expect(await screen.findByTestId('markdown')).toHaveTextContent('Second note');

    await act(async () => firstResponse({ ok: true, json: async () => ({ content: 'First note' }) }));
    expect(screen.getByTestId('markdown')).toHaveTextContent('Second note');
    expect(screen.queryByText('First note')).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('lets a later visit replace a stalled read of the same public link', async () => {
    jest.useFakeTimers();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockFetch
        .mockReturnValueOnce(new Promise(() => {}))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ content: 'A fresh response' }) });

      const first = render(<SharedNotePage />);
      await act(async () => { jest.advanceTimersByTime(15_000); });
      expect(screen.getByText('shareNotes.error')).toBeInTheDocument();
      expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
      first.unmount();
      render(<SharedNotePage />);

      expect(await screen.findByTestId('markdown')).toHaveTextContent('A fresh response');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
      jest.useRealTimers();
    }
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

  // BUG-20261019-routes-hang-when-store-refuses: the database refusing is not "this note is gone".
  it('says the note is temporarily unavailable when the server cannot give it', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    render(<SharedNotePage />);

    await waitFor(() => expect(screen.getByText('shareNotes.unavailable')).toBeInTheDocument());
    expect(screen.queryByText('shareNotes.notFound')).not.toBeInTheDocument();
    expect(screen.queryByText('shareNotes.error')).not.toBeInTheDocument();
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

    // Two titles are drawn — the phone's bar and the wide screen's column — and CSS shows one of them.
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(2));
    screen.getAllByRole('heading', { level: 1 }).forEach((title) => expect(title).toHaveTextContent('Faith that carries'));
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

    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })[0]).toHaveTextContent('Luke 5:17-26'));
    // The passage that became the title is not repeated in the line of passages under it.
    const line = screen.getByText('John 3:16').closest('p')!;
    expect(line).not.toHaveTextContent('Luke 5:17-26');
  });

  it('puts the theme switch at the top — in the reading bar and beside the wide title — and none under the text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ content: 'Body', title: 'Faith that carries', scriptureRefs: [] }),
    });

    render(<SharedNotePage />);

    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('Body'));
    const bar = screen.getAllByRole('heading', { level: 1 }).find((title) => title.closest('header'))!.closest('header')!;
    expect(within(bar).getByTestId('theme-toggle')).toBeInTheDocument();
    const wideTitle = screen.getAllByRole('heading', { level: 1 }).find((title) => !bar.contains(title))!;
    expect(within(wideTitle.parentElement!).getByTestId('theme-toggle')).toBeInTheDocument();
    expect(screen.getAllByTestId('theme-toggle')).toHaveLength(2);
    expect(within(screen.getByRole('contentinfo')).queryByTestId('theme-toggle')).not.toBeInTheDocument();
  });

  it('opens the sheet on all the passages from "and N more" under the title', async () => {
    const scriptureRefs = Array.from({ length: 9 }, (_, index) => ({ id: `r${index}`, book: 'Psalms', chapter: index + 1, fromVerse: 1 }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ content: '# Part\n\nBody', title: 'Psalms', scriptureRefs }),
    });

    render(<SharedNotePage />);

    // The note has an outline, so the sheet would open on it by default.
    fireEvent.click(await screen.findByRole('button', { name: /shareNotes\.morePassages/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: /studiesWorkspace\.scriptureRefs/ })).toHaveAttribute('aria-pressed', 'true');
    // Every passage is there, the ones the line under the title left out too.
    expect(within(sheet).getAllByRole('button', { name: /Psalms|Ps/ }).length).toBeGreaterThanOrEqual(9);
  });

  it('opens the outline from the bar, and a section chosen there closes it', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ content: '# One\n\nFirst.\n\n# Two\n\nSecond.', title: 'Two parts', scriptureRefs: [] }),
    });

    render(<SharedNotePage />);

    fireEvent.click(await screen.findByRole('button', { name: 'notePanel.outline' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'textOutline.collapseAll' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /studiesWorkspace\.scriptureRefs/ })).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Two' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes the outline when the screen turns wide, so the hidden sheet does not keep the page from scrolling', async () => {
    let wide = false;
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('1024') ? wide : false,
      media: query,
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => { if (query.includes('1024')) listeners.push(listener); },
      removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;
    try {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ content: '# One\n\nFirst.', title: 'Turned', scriptureRefs: [] }),
      });
      render(<SharedNotePage />);

      fireEvent.click(await screen.findByRole('button', { name: 'notePanel.outline' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();

      wide = true;
      act(() => listeners.forEach((listener) => listener({ matches: true })));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    } finally {
      window.matchMedia = original;
    }
  });

  it('keeps the phone title as a heading when a named section becomes active', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '## One\n\nFirst.', title: 'Persistent title', scriptureRefs: [] }),
    });
    render(<SharedNotePage />);
    const title = (await screen.findAllByRole('heading', { level: 1, name: 'Persistent title' }))[0];
    const bar = title.closest('header')!;
    // The Markdown stand-in does not emit real section boxes. Give the scroll reader the section
    // the production renderer would put at this position, then deliver a scroll.
    const section = document.createElement('section');
    section.dataset.sectionId = '0';
    section.getBoundingClientRect = () => ({ top: 40 }) as DOMRect;
    (await screen.findByTestId('markdown')).appendChild(section);
    fireEvent.scroll(window);

    await waitFor(() => expect(within(bar).getByText('One')).toBeVisible());
    expect(within(bar).getByRole('heading', { level: 1, name: 'Persistent title' })).toBe(title);
    expect(title.closest('button')).toBeNull();
  });

  it('shows no sheet trigger for a plain public note with no sections or passages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: 'A single paragraph.', title: 'Plain note', scriptureRefs: [] }),
    });
    const { container } = render(<SharedNotePage />);
    const title = (await screen.findAllByRole('heading', { level: 1, name: 'Plain note' }))[0];
    expect(title.closest('header')!.querySelector('button[aria-haspopup="dialog"]')).toBeNull();
    expect(container.querySelector('[data-note-sheet]')).toBeNull();
  });

  it('offers the passages sheet when references are the only navigation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: 'A single paragraph.', title: 'Passages only',
        scriptureRefs: [{ id: 'r1', book: 'John', chapter: 3, fromVerse: 16 }],
      }),
    });
    render(<SharedNotePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'studiesWorkspace.scriptureRefs' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: /John|Jn/ })).toBeInTheDocument();
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
