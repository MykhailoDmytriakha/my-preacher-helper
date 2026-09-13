import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import SettingsShell from '@/(pages)/(private)/settings/layout';
import SettingsIndexPage from '@/(pages)/(private)/settings/page';
import { TestProviders } from '@test-utils/test-providers';

const replace = jest.fn();
let pathname = '/settings/user';
let search = '';

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
  useParams: () => ({}),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'test-user-id', email: 'test@example.com' }, loading: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/hooks/useDocumentFreshness', () => ({
  useDocumentFreshness: () => ({ state: 'fresh', remote: null, remotelyDeleted: false, markSynced: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@locales/i18n', () => ({}));
jest.mock('@/components/navigation/LanguageInitializer', () => () => <div data-testid="language-initializer" />);

/**
 * THE WHOLE POINT OF THE SPLIT, END TO END: a section is an address.
 *
 * The unit suites mock the navigation away; this one runs the real one inside the real
 * shell, so a section that is spelled one way in a link and another in the router shows up
 * here. It also covers the two doors into the screen — the bare address and every bookmark
 * written back when the section was a piece of in-page state.
 */
describe('Settings addresses', () => {
  beforeEach(() => {
    replace.mockClear();
    pathname = '/settings/user';
    search = '';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never;
  });

  const renderShell = () => render(
    <TestProviders><SettingsShell><div data-testid="section-content" /></SettingsShell></TestProviders>
  );

  it('offers every section at its own address, in both navigation layouts', async () => {
    renderShell();

    await waitFor(() => expect(screen.getByTestId('section-content')).toBeInTheDocument());
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    // Two navigation layouts share one content tree, so every address appears twice.
    expect(hrefs.filter((href) => href === '/settings/user')).toHaveLength(2);
    expect(hrefs.filter((href) => href === '/settings/limits')).toHaveLength(2);
    expect(hrefs.filter((href) => href === '/settings/tags')).toHaveLength(2);
    expect(hrefs.filter((href) => href === '/settings/templates')).toHaveLength(2);
  });

  it('marks the section the address names as the current page', async () => {
    pathname = '/settings/limits';
    renderShell();

    await waitFor(() => expect(screen.getByTestId('section-content')).toBeInTheDocument());
    screen.getAllByRole('link', { current: 'page' }).forEach((link) => {
      expect(link).toHaveAttribute('href', '/settings/limits');
    });
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(2);
  });

  it('sends the bare address on to the first section', async () => {
    render(<SettingsIndexPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/user'));
  });

  it.each([
    ['planTemplates', '/settings/templates'],
    ['aiModels', '/settings/limits'],
    ['tags', '/settings/tags'],
  ])('honours a link written before the split: ?section=%s', async (legacy, expected) => {
    search = `?section=${legacy}`;
    render(<SettingsIndexPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(expected));
  });

  it('ignores a section name it does not know and opens the first one', async () => {
    search = '?section=nonsense';
    render(<SettingsIndexPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/user'));
  });
});
