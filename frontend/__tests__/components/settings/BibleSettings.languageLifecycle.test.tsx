import { act, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { BibleSettingsLink } from '@/components/bible/BibleSettingsLink';
import { resetCrossReferencePrefsForTests } from '@/components/bible/crossReferencePrefs';
import { resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import FloatingTextScaleControls from '@/components/FloatingTextScaleControls';
import ProtectedRoute from '@/components/ProtectedRoute';
import CrossReferenceSettings from '@/components/settings/CrossReferenceSettings';
import PlaceTrailSettings from '@/components/settings/PlaceTrailSettings';
import { TextScaleProvider } from '@/providers/TextScaleProvider';
import i18n from '@locales/i18n';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

const { renderToString } = require('react-dom/server.node') as typeof import('react-dom/server');
jest.mock('i18next', () => jest.requireActual('i18next'));
jest.mock('react-i18next', () => jest.requireActual('react-i18next'));
let mockAuth = { user: null as { uid: string } | null, loading: true };
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuth }));

const languages = [['en', en], ['ru', ru], ['uk', uk]] as const;

beforeEach(() => {
  mockAuth = { user: null, loading: true };
  window.localStorage.clear();
  resetCrossReferencePrefsForTests();
  resetPlaceTrailForTests();
});

async function restoreAfterLanguage(
  children: React.ReactNode,
  language: string,
  check: (container: HTMLElement) => Promise<void>,
) {
  await i18n.changeLanguage('en');
  const tree = () => <I18nextProvider i18n={i18n}><ProtectedRoute>{children}</ProtectedRoute></I18nextProvider>;
  const container = document.createElement('div');
  container.innerHTML = renderToString(tree());
  document.body.appendChild(container);
  // The real private-route host renders only its spinner before auth restoration.
  expect(container.querySelector('[data-testid="cross-reference-settings"]')).toBeNull();
  expect(container.querySelector('[data-testid="place-trail-settings"]')).toBeNull();
  expect(container.querySelector('a[href="/settings/bible"]')).toBeNull();
  const errors: unknown[] = [];
  let root: Root | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, tree(), { onRecoverableError: error => errors.push(error) }); });
    await act(async () => { await i18n.changeLanguage(language); });
    await act(async () => { mockAuth = { user: { uid: 'owner' }, loading: false }; root?.render(tree()); });
    await check(container);
    expect(errors).toEqual([]);
  } finally {
    await act(async () => { root?.unmount(); });
    container.remove();
  }
}

it.each(languages)('shows both Bible settings blocks in %s after the private session restores', async (language, words) => {
  await restoreAfterLanguage(<><CrossReferenceSettings /><PlaceTrailSettings /></>, language, async container => {
    const view = within(container);
    expect(await view.findByRole('heading', { name: words.settings.bible.crossRefs.title })).toBeInTheDocument();
    expect(await view.findByRole('heading', { name: words.settings.bible.trail.title })).toBeInTheDocument();
    const references = container.querySelector('[data-testid="cross-reference-settings"]');
    const trail = container.querySelector('[data-testid="place-trail-settings"]');
    const next = languages.find(([code]) => code !== language)!;
    await act(async () => { await i18n.changeLanguage(next[0]); });
    await waitFor(() => expect(view.getByRole('heading', { name: next[1].settings.bible.crossRefs.title })).toBeInTheDocument());
    expect(view.getByRole('heading', { name: next[1].settings.bible.trail.title })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="cross-reference-settings"]')).toBe(references);
    expect(container.querySelector('[data-testid="place-trail-settings"]')).toBe(trail);
  });
});

it.each(languages)('opens the actual T control and its settings link in %s after session restoration', async (language, words) => {
  await restoreAfterLanguage(<TextScaleProvider><FloatingTextScaleControls><BibleSettingsLink /></FloatingTextScaleControls></TextScaleProvider>, language, async container => {
    const view = within(container);
    expect(view.queryByRole('link')).not.toBeInTheDocument();
    const trigger = await view.findByRole('button', { name: words.textScale.open });
    fireEvent.click(trigger);
    const link = await view.findByRole('link', { name: words.bible.settingsLink });
    expect(link).toHaveAttribute('href', '/settings/bible');
    const next = languages.find(([code]) => code !== language)!;
    await act(async () => { await i18n.changeLanguage(next[0]); });
    await waitFor(() => expect(view.getByRole('link', { name: next[1].bible.settingsLink })).toBe(link));
  });
});
