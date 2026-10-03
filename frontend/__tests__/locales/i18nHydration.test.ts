/**
 * The first render in the browser must speak the language the server rendered in
 * (BUG-20260902-ssr-renders-english-labels-then-swaps): the server cannot know the device's
 * language for a prerendered page, so a client that starts in the cookie's language fails
 * hydration on every translated string.
 */
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import LanguageInitializer from '@/components/navigation/LanguageInitializer';
import i18n from '@locales/i18n';

// The real libraries: the shared setup replaces both with stand-ins that have no language at all.
jest.mock('i18next', () => jest.requireActual('i18next'));
jest.mock('react-i18next', () => jest.requireActual('react-i18next'));
let mockAuthState: { user: null; loading: boolean } = { user: null, loading: true };
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuthState }));
jest.mock('@locales/getInitialLang', () => ({ initializeLanguageFromDB: jest.fn() }));

describe('the language the page hydrates in', () => {
  afterEach(() => {
    document.cookie = 'lang=; path=/; max-age=0';
  });

  it('is the default language, whatever the device language is', () => {
    document.cookie = 'lang=ru; path=/';
    let language: string | undefined;
    jest.isolateModules(() => {
      language = (require('@locales/i18n') as typeof import('@locales/i18n')).default.language;
    });

    expect(language).toBe('en');
  });
});

describe('the switch to the device language after hydration', () => {
  afterEach(() => {
    document.cookie = 'lang=; path=/; max-age=0';
    mockAuthState = { user: null, loading: true };
  });

  it.each([
    ['while sign-in is still loading', true],
    ['when sign-in already answered with no account', false],
  ])('reaches components mounted after the initializer %s', async (_label, loading) => {
    mockAuthState = { user: null, loading };
    // The initializer sits before the page in the root layout; its effect runs before later siblings
    // subscribe to language changes, and a switch they did not hear left them in English for good.
    await i18n.changeLanguage('en');
    document.cookie = 'lang=ru; path=/';
    function Label() {
      const { t } = useTranslation();
      return React.createElement('span', { 'data-testid': 'label' }, t('buttons.retry'));
    }

    render(React.createElement(I18nextProvider, { i18n }, React.createElement(LanguageInitializer), React.createElement(Label)));

    await waitFor(() => expect(screen.getByTestId('label')).toHaveTextContent('Повторить'));
  });

  it('declares the page language once the interface switches, for screen readers and translation', async () => {
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    document.cookie = 'lang=ru; path=/';

    render(React.createElement(I18nextProvider, { i18n }, React.createElement(LanguageInitializer)));

    await waitFor(() => expect(document.documentElement.lang).toBe('ru'));
  });
});
