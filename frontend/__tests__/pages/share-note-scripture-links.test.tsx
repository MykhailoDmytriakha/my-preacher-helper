import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { useParams } from 'next/navigation';

import '@testing-library/jest-dom';
import SharedNotePage from '@/(pages)/share/notes/[token]/page';
import { fetchBookText } from '@/utils/bibleText';

/*
 * The owner, 2026-11-17: on the page of a note opened by its share link, read-only, the Scripture in the
 * text was plain words. As in the app, a reference is a link, and pressing it opens the passage the
 * usual way — over the page. The Bible page itself is behind sign-in, so a reader without an account is
 * not sent there.
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  useParams: jest.fn(),
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/share/notes/token-1',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@components/navigation/ThemeModeToggle', () => ({ __esModule: true, default: () => null }));
// react-markdown is replaced for the whole test run (jest.setup.js), so its link plugin never runs here;
// this stand-in renders the text the way the real one does inside a links context — references as links.
jest.mock('@components/MarkdownDisplay', () => {
  const { ScriptureText, useScriptureLinks } = jest.requireActual('@/components/bible/ScriptureLinks');
  return {
    __esModule: true,
    default: function MarkdownStandIn({ content }: { content: string }) {
      const links = useScriptureLinks();
      return <div data-testid="markdown" data-scripture-links={links ? 'on' : 'off'}>{links ? <ScriptureText text={content} /> : content}</div>;
    },
  };
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}));
let mockSignedIn = false;
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockSignedIn ? { uid: 'reader-1' } : null, loading: false }),
}));
jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn() }));

const ruth = { id: 'Ruth', chapters: [['¶Первый', 'Второй', 'Третий'], ['¶Глава два'], ['¶Глава три'], ['¶Глава четыре']] };

beforeEach(() => {
  mockSignedIn = false;
  window.localStorage.setItem('bible:translation', 'rst');
  jest.mocked(fetchBookText).mockReset().mockResolvedValue(ruth as never);
  jest.mocked(useParams).mockReturnValue({ token: 'token-1' });
  mockFetch.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ title: 'Верность', content: 'Куда ты пойдёшь, туда и я пойду (Руфь 1:2).', scriptureRefs: [] }),
  });
});

it('turns a reference in the shared text into a link that opens the passage over the page', async () => {
  render(<SharedNotePage />);
  const link = await screen.findByRole('button', { name: 'Руфь 1:2' });
  fireEvent.click(link);
  // The passage itself is read in the window: Ruth 1:2 is «Второй» in the test Bible.
  expect(await within(await screen.findByRole('dialog')).findByText(/Второй/)).toBeInTheDocument();
});

it('turns the passages named under the title into links too', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ title: 'Верность', content: 'Текст без ссылок.', scriptureRefs: [{ book: 'Ruth', chapter: 1, fromVerse: 2 }] }),
  });
  render(<SharedNotePage />);
  // The line under the title, not the passage's chip in the wide screen's panel.
  const line = (await screen.findByText(/Руфь 1:2/, { selector: 'button' })).closest('p')!;
  fireEvent.click(within(line).getByRole('button', { name: /1:2/ }));
  expect(await within(await screen.findByRole('dialog')).findByText(/Второй/)).toBeInTheDocument();
});

it('does not send a reader without an account to the Bible page, which needs one', async () => {
  render(<SharedNotePage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Руфь 1:2' }));
  await screen.findByRole('dialog');
  expect(screen.queryByRole('button', { name: 'bible.sheet.openInBible' })).not.toBeInTheDocument();
});

it('offers the Bible page to a signed-in reader, as everywhere in the app', async () => {
  mockSignedIn = true;
  render(<SharedNotePage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Руфь 1:2' }));
  await screen.findByRole('dialog');
  expect(screen.getByRole('button', { name: 'bible.sheet.openInBible' })).toBeInTheDocument();
});
