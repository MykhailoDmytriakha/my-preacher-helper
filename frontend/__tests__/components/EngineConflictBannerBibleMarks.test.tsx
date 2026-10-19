import { act, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import en from '@locales/en/translation.json';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
let mockPathname = '/dashboard';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
const mockTranslate = (key: string, values?: Record<string, unknown>) => {
  const found = key.split('.').reduce<unknown>((value, field) => value && typeof value === 'object' ? (value as Record<string, unknown>)[field] : undefined, en);
  return typeof found === 'string' ? found.replace(/{{(\w+)}}/g, (_, field: string) => String(values?.[field] ?? field)) : key;
};
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: mockTranslate, language: 'en' }) }));

const resource = { collection: 'bibleMarks', id: 'owner_rst_ruth' };
const stored = { userId: 'owner', bible: 'rst', book: 'Ruth', verses: { v1_1: { m: '0-1-red' } }, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' };
let actions: ReturnType<typeof useDocumentActions> | null = null;
function Actions() { const current = useDocumentActions(); useEffect(() => { actions = current; }); return null; }
function setup() {
  const harness = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'book-generation', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const view = render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={25} /></DataEngineProvider>);
  return Object.assign(harness, { view });
}
async function leaveConflict(harness: ReturnType<typeof setup>) {
  await waitFor(() => expect(actions?.ready).toBe(true));
  const editor = await harness.engine.openEditor(resource, editorIdentity('test-tab', resource, 'default', 'marks-left'));
  harness.silentRemote({ verses: { v1_1: { m: '0-1-green' } } });
  await act(async () => {
    await editor.edit({ ...stored, verses: { v1_1: { m: '0-1-blue' } } });
    await editor.save(); await settleEngine(); await settleEngine();
    editor.close({ flush: false }); await settleEngine();
  });
  await screen.findByText(mockTranslate('dataSync.screenDraftBody'));
}

beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'bibleMarks'; mockPathname = '/dashboard'; actions = null; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; window.history.replaceState(null, '', '/'); });

it('names the marked place and meaning outside the book instead of exposing compact storage fields', async () => {
  const harness = setup();
  await leaveConflict(harness);
  const notice = screen.getByRole('alert');
  expect(notice.textContent).toContain('Ruth 1:1');
  expect(notice.textContent).toContain('Marker: About man');
  expect(notice.textContent).toContain('Words 1–2');
  expect(notice.textContent).not.toMatch(/v1_1|0-1-blue|"m"/);
  expect(harness.server.value?.verses).toEqual({ v1_1: { m: '0-1-green' } });
});

it('links to the Bible and book that own the marks, independently of this device reading another translation', async () => {
  window.localStorage.setItem('bible:translation', 'kjv');
  const harness = setup();
  await leaveConflict(harness);
  expect(screen.getByRole('link', { name: mockTranslate('dataSync.openToDecide') })).toHaveAttribute('href', '/bible?book=ruth&read=rst');
});

it.each(['/bible', '/~offline'])('yields only once the matching reader actually holds the whole answered draft at %s', async pathname => {
  const harness = setup();
  await leaveConflict(harness);
  mockPathname = pathname;
  window.history.replaceState(null, '', '/bible?book=ruth');
  harness.view.rerender(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={60_000} /></DataEngineProvider>);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  const reopened = await harness.engine.openEditor(resource, editorIdentity('test-tab', resource, 'default', 'marks-reopened'));
  try {
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument(), { timeout: 400 });
    expect(reopened.getState().checkpoint.draft?.verses).toEqual({ v1_1: { m: '0-1-blue' } });
    for (const search of ['book=john', '', 'book=ruth&read=kjv']) {
      harness.view.rerender(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={60_000} search={search} /></DataEngineProvider>);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    }
    harness.view.rerender(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={60_000} search="book=ruth" /></DataEngineProvider>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => { reopened.close({ flush: false }); await settleEngine(); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 400 });
  } finally { reopened.close({ flush: false }); }
});

it('retains the global decision when a reader on the route has not taken over the submitted work', async () => {
  mockPathname = '/bible';
  const harness = setup();
  await waitFor(() => expect(actions?.ready).toBe(true));
  const earlier = await harness.engine.openEditor(resource, editorIdentity('test-tab', resource, 'default', 'earlier-reader'));
  try { await leaveConflict(harness); expect(screen.getByRole('alert')).toBeInTheDocument(); }
  finally { earlier.close({ flush: false }); }
});
