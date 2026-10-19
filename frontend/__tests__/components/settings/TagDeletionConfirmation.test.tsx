import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import React, { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import TagsSection from '@/components/settings/TagsSection';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { useTags } from '@/hooks/useTags';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { User } from 'firebase/auth';

jest.mock('i18next', () => jest.requireActual('i18next'));
jest.mock('react-i18next', () => jest.requireActual('react-i18next'));
jest.mock('@/hooks/useTags', () => ({ useTags: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('next/navigation', () => ({ usePathname: () => '/settings' }));

const locales = { en, ru, uk };
const tagName = 'Hope & <peace> {{name}}';
const tag = { id: 'hope', userId: 'owner', name: tagName, color: '#112233', required: false };
const remove = jest.fn().mockResolvedValue(undefined);
let actions: ReturnType<typeof useDocumentActions> | null = null;
function Actions() { const current = useDocumentActions(); useEffect(() => { actions = current; }); return null; }
async function language(lng: keyof typeof locales) {
  const i18n = createInstance();
  await i18n.init({ lng, fallbackLng: 'en', resources: Object.fromEntries(Object.entries(locales).map(([key, translation]) => [key, { translation }])),
    interpolation: { escapeValue: false }, react: { useSuspense: false } });
  return i18n;
}
function expectLabelQuestion(i18n: Awaited<ReturnType<typeof language>>) {
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAccessibleName(expect.stringContaining(tagName));
  expect(dialog).toHaveAccessibleDescription(i18n.t('settings.deleteTagConfirmation.description'));
  expect(dialog).not.toHaveTextContent(i18n.t('common.deleteItem.description'));
  expect(dialog.querySelector('peace')).toBeNull();
  if (i18n.language === 'en') expect(dialog).toHaveTextContent('This tag will be removed from all thoughts. Their text and other tags will stay.');
  return dialog;
}
beforeEach(() => {
  jest.clearAllMocks(); actions = null;
  jest.mocked(useTags).mockReturnValue({ tags: { requiredTags: [], customTags: [tag] }, addCustomTag: jest.fn(), removeCustomTag: remove, updateTag: jest.fn() } as never);
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'tags';
});
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

it.each(['en', 'ru', 'uk'] as const)('%s: names the selected tag, explains retained thoughts and cancels without a write', async lng => {
  const i18n = await language(lng);
  render(<I18nextProvider i18n={i18n}><TagsSection user={{ uid: 'owner' } as User} /></I18nextProvider>);
  fireEvent.click(screen.getByRole('button', { name: `${i18n.t('settings.deleteTag')} ${tagName}` }));
  const dialog = expectLabelQuestion(i18n);
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('common.cancel') }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(remove).not.toHaveBeenCalled();
});

it.each(['en', 'ru', 'uk'] as const)('%s: repeats the same label-specific warning after a server refusal and deletes only on confirmation', async lng => {
  const i18n = await language(lng);
  const resource = { collection: 'tags', id: tag.id };
  const harness = documentEngineHarness({ resource, value: tag, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<I18nextProvider i18n={i18n}><DataEngineProvider><Actions /><EngineConflictBanner pollMs={25} /></DataEngineProvider></I18nextProvider>);
  await waitFor(() => expect(actions?.ready).toBe(true));
  jest.mocked(harness.transport.send).mockImplementationOnce(async command => ({ kind: 'refused', operationId: command.operationId, code: 'related-collection-not-enabled' }));
  await act(async () => { await actions!.remove(resource); await settleEngine(); await settleEngine(); });
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('dataSync.retryDelete') }));
  let dialog = expectLabelQuestion(i18n);
  expect(harness.server.metadata?.deleted).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('common.cancel') }));
  expect(harness.server.metadata?.deleted).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('dataSync.retryDelete') }));
  dialog = expectLabelQuestion(i18n);
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('common.delete') }));
  await waitFor(() => expect(harness.server.metadata?.deleted).toBe(true));
});

it('re-says the same selected tag while the confirmation language changes', async () => {
  const i18n = await language('en');
  render(<I18nextProvider i18n={i18n}><TagsSection user={{ uid: 'owner' } as User} /></I18nextProvider>);
  fireEvent.click(screen.getByRole('button', { name: `${i18n.t('settings.deleteTag')} ${tagName}` }));
  expectLabelQuestion(i18n);
  await act(async () => { await i18n.changeLanguage('ru'); });
  expectLabelQuestion(i18n);
  expect(remove).not.toHaveBeenCalled();
});
