import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { useParams } from 'next/navigation';

import '@testing-library/jest-dom';
import SharedNotePage from '@/(pages)/share/notes/[token]/page';
import { fetchBookText } from '@/utils/bibleText';

/*
 * BUG-20261118-shared-note-guest-reads-english-bible (the owner, 18.11, in a private window): a guest
 * with no language of their own opened a Russian shared note; the page spoke the app's default English
 * and the verse window opened the King James. A reader who has chosen nothing reads the note's page in
 * the note's language — the Bible follows it by the existing rule; a reader's own choice still wins.
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
// react-markdown is replaced for the whole test run (jest.setup.js); this stand-in links references
// the way the real renderer does inside a links context.
jest.mock('@components/MarkdownDisplay', () => {
  const { ScriptureText, useScriptureLinks } = jest.requireActual('@/components/bible/ScriptureLinks');
  return {
    __esModule: true,
    default: function MarkdownStandIn({ content }: { content: string }) {
      const links = useScriptureLinks();
      return <div data-testid="markdown">{links ? <ScriptureText text={content} /> : content}</div>;
    },
  };
});
// i18next is replaced for the whole test run (jest.setup.js) with an instance whose language never
// moves; this one moves and tells its subscribers, as the real one does.
const mockLanguageListeners = new Set<() => void>();
const mockI18n = {
  language: 'en',
  resolvedLanguage: 'en',
  options: { react: {} },
  on: (_event: string, listener: () => void) => { mockLanguageListeners.add(listener); },
  off: (_event: string, listener: () => void) => { mockLanguageListeners.delete(listener); },
  changeLanguage: async (language: string) => {
    mockI18n.language = language;
    mockI18n.resolvedLanguage = language;
    mockLanguageListeners.forEach(listener => listener());
  },
  getFixedT: () => (key: string) => key,
};
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: mockI18n, ready: true }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));
let mockAuth: { user: { uid: string } | null; loading: boolean } = { user: null, loading: false };
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn() }));

const ruth = { id: 'Ruth', chapters: [['¶Первый', 'Второй', 'Третий'], ['¶Глава два'], ['¶Глава три'], ['¶Глава четыре']] };
const biblesRead = () => jest.mocked(fetchBookText).mock.calls.map(call => call[1]);

async function openThePassage() {
  render(<SharedNotePage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Руфь 1:2' }));
  await within(await screen.findByRole('dialog')).findByText(/Второй/);
}

beforeEach(async () => {
  mockAuth = { user: null, loading: false };
  document.cookie = 'lang=; Max-Age=0; path=/';
  window.localStorage.removeItem('bible:translation');
  mockI18n.language = 'en';
  mockI18n.resolvedLanguage = 'en';
  jest.mocked(fetchBookText).mockReset().mockResolvedValue(ruth as never);
  jest.mocked(useParams).mockReturnValue({ token: 'token-1' });
  mockFetch.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ title: 'Верность', content: 'Куда ты пойдёшь, туда и я пойду (Руфь 1:2).', scriptureRefs: [] }),
  });
});

it('reads a Russian note to a guest with no language of their own in Russian, the Bible included', async () => {
  await openThePassage();
  expect(mockI18n.language).toBe('ru');
  expect(biblesRead()).toEqual(['rst']);
});

it('keeps the language a reader chose on this device', async () => {
  document.cookie = 'lang=en; path=/';
  await openThePassage();
  expect(mockI18n.language).toBe('en');
  expect(biblesRead()).toEqual(['kjv']);
});

it('keeps the Bible a reader chose, whatever the page speaks', async () => {
  window.localStorage.setItem('bible:translation', 'kjv');
  await openThePassage();
  expect(biblesRead()).toEqual(['kjv']);
});

it('leaves a signed-in reader to the language of their account', async () => {
  mockAuth = { user: { uid: 'reader-1' }, loading: false };
  await openThePassage();
  expect(mockI18n.language).toBe('en');
  expect(biblesRead()).toEqual(['kjv']);
});
