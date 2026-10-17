import { act, render, screen, waitFor } from '@testing-library/react';

import BiblePage from '@/(pages)/(private)/bible/page';

import kjvPsalms from '../../public/bible-text/kjv/v1/psalms.json';
import rstPsalms from '../../public/bible-text/rst/v1/psalms.json';

let mockLanguage = 'en';
let mockLoading = true;
let mockSettings: { language: string } | null = null;

jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/bible',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'reader', isAuthLoading: false }) }));
jest.mock('@/hooks/useUserSettings', () => ({
  ...jest.requireActual('@/hooks/useUserSettings'),
  useUserSettingsQuery: () => ({ data: mockSettings, isLoading: mockLoading, error: null, isOnline: true }),
}));
jest.mock('@locales/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: mockLanguage, i18n: { language: mockLanguage } }),
}));
// Keep the actual reader and its history-entry anchoring. A reader stub misses this defect.
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: () => ({ data: null, loading: true, commit: jest.fn(), status: null, recoveryIdentity: {} }),
}));

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
const place = () => screen.getByRole('button', { name: 'bible.changeChapter' });

beforeEach(() => {
  mockLanguage = 'en';
  mockLoading = true;
  mockSettings = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.cookie = 'lang=; Max-Age=0; path=/';
  window.history.replaceState(null, '', '/bible?book=psalms&at=22:1');
  window.matchMedia = jest.fn(query => ({
    matches: true, media: query, onchange: null, addEventListener: jest.fn(), removeEventListener: jest.fn(),
    addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  window.scrollTo = jest.fn();
  Element.prototype.scrollIntoView = jest.fn();
  global.fetch = jest.fn(async (url: RequestInfo | URL) => ({
    ok: true, status: 200,
    json: async () => String(url).includes('/rst/') ? rstPsalms : kjvPsalms,
    clone() { return this; },
  })) as unknown as typeof fetch;
});

describe('Bible address before the reader language is known', () => {
  it('shows progress while the initial profile is pending and replaces it with the requested text', async () => {
    const view = render(<BiblePage />);
    expect(screen.getByRole('status')).toHaveTextContent('common.loading');
    mockSettings = { language: 'ru' };
    mockLoading = false;
    mockLanguage = 'ru';
    view.rerender(<BiblePage />);
    await waitFor(() => expect(place()).toHaveTextContent('22:1'));
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
  });

  it('does not interpret a new link using a cookie from an older interface language', async () => {
    document.cookie = 'lang=en; path=/';
    const view = render(<BiblePage />);
    await settle();
    mockSettings = { language: 'ru' };
    mockLoading = false;
    mockLanguage = 'ru';
    view.rerender(<BiblePage />);
    await waitFor(() => expect(place()).toHaveTextContent('22:1'));
    expect(screen.getByRole('button', { name: 'bible.changeTranslation' }).querySelector('span[lang]')).toHaveAttribute('lang', 'ru');
  });

  it.each([false, true])('opens the requested Synodal psalm after profile arrival: profile publishes first=%s', async profileFirst => {
    const view = render(<BiblePage />);
    await settle();
    mockSettings = { language: 'ru' };
    mockLoading = false;
    if (profileFirst) {
      view.rerender(<BiblePage />);
      await settle();
    }
    mockLanguage = 'ru';
    view.rerender(<BiblePage />);
    await waitFor(() => expect(place()).toHaveTextContent('22:1'));
    expect(screen.getByRole('button', { name: 'bible.changeTranslation' }).querySelector('span[lang]')).toHaveAttribute('lang', 'ru');
  });

  it.each(['explicit numbering', 'saved Bible', 'known language'])('preserves %s while the profile arrives', async mode => {
    if (mode === 'explicit numbering') window.history.replaceState(null, '', '/bible?book=psalms&at=22:1&tr=rst');
    if (mode === 'saved Bible') window.localStorage.setItem('bible:translation', 'kjv');
    if (mode === 'known language') mockLanguage = 'ru';
    const view = render(<BiblePage />);
    await settle();
    mockSettings = { language: 'ru' };
    mockLoading = false;
    mockLanguage = 'ru';
    view.rerender(<BiblePage />);
    await waitFor(() => expect(place()).toHaveTextContent('22:1'));
    expect(screen.getByRole('button', { name: 'bible.changeTranslation' }).querySelector('span[lang]')).toHaveAttribute('lang', mode === 'saved Bible' ? 'en' : 'ru');
  });
});
