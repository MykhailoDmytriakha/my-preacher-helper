import { act, render, screen, waitFor } from '@testing-library/react';
import React, { Suspense, useLayoutEffect } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { useTranslation } from '@locales/useTranslation';

import { useAppLocale } from '@/hooks/useAppLocale';
import i18n from '@locales/i18n';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

const { renderToString } = require('react-dom/server.node') as typeof import('react-dom/server');

jest.mock('i18next', () => jest.requireActual('i18next'));
jest.mock('react-i18next', () => jest.requireActual('react-i18next'));

function Label() {
  const { t } = useTranslation();
  return <span data-testid="late-language">{t('buttons.retry')}</span>;
}

const cases = [
  ['en', en.buttons.retry],
  ['ru', ru.buttons.retry],
  ['uk', uk.buttons.retry],
] as const;

it.each(cases)('keeps %s when the language changes before the subscription commits', async (language, expected) => {
  await i18n.changeLanguage('en');
  function SwitchBeforeSubscription() {
    useLayoutEffect(() => { void i18n.changeLanguage(language); }, []);
    return null;
  }
  render(<I18nextProvider i18n={i18n}><Label /><SwitchBeforeSubscription /></I18nextProvider>);
  expect(i18n.language).toBe(language);
  await waitFor(() => expect(screen.getByTestId('late-language')).toHaveTextContent(expected));
});

it.each(cases)('hydrates a delayed boundary in %s without replacing server markup', async (language, expected) => {
  await i18n.changeLanguage('en');
  let pending: Promise<void> | null = null;
  let release = () => {};
  function DelayedLabel() {
    if (pending) throw pending;
    return <Label />;
  }
  const tree = <I18nextProvider i18n={i18n}><Suspense fallback={<span>Loading</span>}><DelayedLabel /></Suspense></I18nextProvider>;
  const container = document.createElement('div');
  container.innerHTML = renderToString(tree);
  document.body.appendChild(container);
  const originalLabel = container.querySelector('[data-testid="late-language"]');
  expect(originalLabel).toHaveTextContent(en.buttons.retry);
  pending = new Promise<void>((resolve) => { release = resolve; });
  const errors: unknown[] = [];
  let root: Root | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: (error) => errors.push(error) }); });
    await act(async () => { await i18n.changeLanguage(language); });
    await act(async () => { pending = null; release(); });
    await waitFor(() => expect(container.querySelector('[data-testid="late-language"]')).toHaveTextContent(expected));
    expect(errors).toEqual([]);
    expect(container.querySelector('[data-testid="late-language"]')).toBe(originalLabel);
  } finally {
    await act(async () => { root?.unmount(); });
    container.remove();
  }
});

// Exercise the real shared date/calendar locale consumer in the delayed boundary.
it.each(cases)('hydrates real locale formatting in a delayed %s boundary', async (language) => {
  await i18n.changeLanguage('en');
  let pending: Promise<void> | null = null;
  let release = () => {};
  function LocaleLabel() {
    if (pending) throw pending;
    const { locale } = useAppLocale();
    return <span data-testid="formatted-language" lang={locale}>{new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date('2026-01-01T00:00:00Z'))}</span>;
  }
  const tree = <I18nextProvider i18n={i18n}><Suspense fallback={null}><LocaleLabel /></Suspense></I18nextProvider>;
  const container = document.createElement('div');
  container.innerHTML = renderToString(tree);
  document.body.appendChild(container);
  const original = container.querySelector('span');
  expect(original).toHaveAttribute('lang', 'en');
  pending = new Promise<void>(resolve => { release = resolve; });
  const errors: unknown[] = [];
  let root: Root | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: error => errors.push(error) }); });
    await act(async () => { await i18n.changeLanguage(language); });
    await act(async () => { pending = null; release(); });
    await waitFor(() => expect(container.querySelector('span')).toHaveAttribute('lang', language));
    expect(container.querySelector('span')).toHaveTextContent(new Intl.DateTimeFormat(language, { month: 'long', timeZone: 'UTC' }).format(new Date('2026-01-01T00:00:00Z')));
    expect(errors).toEqual([]);
    expect(container.querySelector('span')).toBe(original);
  } finally {
    await act(async () => { root?.unmount(); });
    container.remove();
  }
});
