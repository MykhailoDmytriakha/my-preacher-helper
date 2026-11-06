import { act, render, waitFor, within } from '@testing-library/react';
import React, { Suspense, useLayoutEffect } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { SignBar } from '@/components/bible/search/SignBar';
import i18n from '@locales/i18n';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

const { renderToString } = require('react-dom/server.node') as typeof import('react-dom/server');
jest.mock('i18next', () => jest.requireActual('i18next'));
jest.mock('react-i18next', () => jest.requireActual('react-i18next'));

const cases = [['en', en.bible.search.help], ['ru', ru.bible.search.help], ['uk', uk.bible.search.help]] as const;
const bar = () => <SignBar onSign={jest.fn()} onHelp={jest.fn()} />;

it.each(cases)('the real search controls catch a %s switch before subscription', async (language, expected) => {
  await i18n.changeLanguage('en');
  function SwitchBeforeSubscription() {
    useLayoutEffect(() => { void i18n.changeLanguage(language); }, []);
    return null;
  }
  const view = render(<I18nextProvider i18n={i18n}>{bar()}<SwitchBeforeSubscription /></I18nextProvider>);
  await waitFor(() => expect(within(view.container).getByRole('button', { name: expected })).toBeVisible());
});

it.each(cases)('the real search controls hydrate a delayed %s boundary without replacement', async (language, expected) => {
  await i18n.changeLanguage('en');
  let pending: Promise<void> | null = null;
  let release = () => {};
  function DelayedControls() {
    if (pending) throw pending;
    return bar();
  }
  const tree = <I18nextProvider i18n={i18n}><Suspense fallback={<span>Loading</span>}><DelayedControls /></Suspense></I18nextProvider>;
  const container = document.createElement('div');
  container.innerHTML = renderToString(tree);
  document.body.appendChild(container);
  const original = within(container).getByRole('button', { name: en.bible.search.help });
  pending = new Promise<void>(resolve => { release = resolve; });
  const errors: unknown[] = [];
  let root: Root | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: error => errors.push(error) }); });
    await act(async () => { await i18n.changeLanguage(language); });
    await act(async () => { pending = null; release(); });
    await waitFor(() => expect(within(container).getByRole('button', { name: expected })).toBeVisible());
    expect(errors).toEqual([]);
    expect(within(container).getByRole('button', { name: expected })).toBe(original);
  } finally {
    await act(async () => { root?.unmount(); });
    container.remove();
  }
});
