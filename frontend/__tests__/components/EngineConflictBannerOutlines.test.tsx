import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { DocumentData } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
const mockTranslate = (key: string) => key;
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: mockTranslate, language: 'en' }) }));

let actions: ReturnType<typeof useDocumentActions> | null = null;
function Actions() { const current = useDocumentActions(); useEffect(() => { actions = current; }); return null; }
const at = '2026-10-01T00:00:00.000Z';
const outline = () => ({ introduction: [{ id: 'private-point', text: 'Opening words', note: 'Keep this reminder', isReviewed: true,
  subPoints: [{ id: 'private-late', text: 'Later subpoint', position: 9 }, { id: 'private-first', text: 'First subpoint', position: 2, note: 'Keep the subpoint reminder' }] }],
main: [{ id: 'private-retained', text: 'Retained main point' }], conclusion: [] });
const expected = ['structure.introduction', '- Opening words', '  Keep this reminder', '  structure.markedAsReviewed',
  '  - First subpoint', '    Keep the subpoint reminder', '  - Later subpoint', '', 'structure.mainPart', '- Retained main point', '', 'structure.conclusion'].join('\n');

async function preview(collection: 'planTemplates' | 'sermons', screenOwned: boolean, unknown = false) {
  const field = collection === 'planTemplates' ? 'structure' : 'outline';
  const resource = { collection, id: 'outline-choice' };
  const baseline = { introduction: [], main: [{ id: 'private-retained', text: 'Retained main point' }], conclusion: [] };
  const value: DocumentData = collection === 'planTemplates'
    ? { userId: 'owner', name: 'Template', structure: baseline, createdAt: at, updatedAt: at }
    : { userId: 'owner', title: 'Sermon', verse: 'John 3:16', date: at, thoughts: [], outline: baseline };
  const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const view = render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={25} /></DataEngineProvider>);
  await waitFor(() => expect(actions?.ready).toBe(true));
  const local = outline();
  if (unknown) Object.assign(local.introduction[0], { extensionWords: 'Unknown authored evidence' });
  jest.mocked(harness.transport.send).mockImplementationOnce(async command => ({ kind: 'refused', operationId: command.operationId, code: 'permission-denied' }));
  const editor = screenOwned ? await harness.engine.openEditor(resource, editorIdentity('test-tab', resource, 'default', 'outline-page')) : null;
  await act(async () => {
    if (editor) { await editor.edit({ ...value, [field]: local } as unknown as DocumentData); await editor.save(); }
    else await actions!.commit(resource, current => ({ ...current!, [field]: local } as unknown as DocumentData));
    await settleEngine(); await settleEngine();
  });
  editor?.close({ flush: false });
  await screen.findByText(screenOwned ? 'dataSync.screenDraftBody' : 'dataSync.phase.refused');
  const label = `legacyRecovery.field.${field}`;
  const shown = screen.getByText(content => content.startsWith(`${label}: `)).textContent ?? '';
  return { harness, view, shown, label };
}

beforeEach(() => { actions = null; process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'planTemplates,sermons'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

describe('readable saved outline choices', () => {
  it.each([
    ['planTemplates', false], ['planTemplates', true], ['sermons', false], ['sermons', true],
  ] as const)('shows %s outline words in order for screen ownership %s', async (collection, screenOwned) => {
    const { harness, view, shown, label } = await preview(collection, screenOwned);
    try {
      expect(shown).toBe(`${label}: ${expected}`);
      expect(shown).not.toMatch(/private-point|private-first|private-late|private-retained|"id"|"position"/);
      expect(harness.server.value?.[collection === 'planTemplates' ? 'name' : 'title']).toBe(collection === 'planTemplates' ? 'Template' : 'Sermon');
      expect(harness.server.value?.[collection === 'planTemplates' ? 'structure' : 'outline']).not.toEqual(outline());
    } finally { view.unmount(); await act(settleEngine); }
  });

  it('copies exactly the readable words reviewed in the closed-screen notice', async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const secure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    const { view, shown, label } = await preview('planTemplates', true);
    try {
      expect(shown).toBe(`${label}: ${expected}`);
      fireEvent.click(screen.getByText('freshness.copyTextAction'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(shown));
    } finally {
      view.unmount(); await act(settleEngine);
      if (previous) Object.defineProperty(navigator, 'clipboard', previous); else Reflect.deleteProperty(navigator, 'clipboard');
      if (secure) Object.defineProperty(window, 'isSecureContext', secure); else Reflect.deleteProperty(window, 'isSecureContext');
    }
  });

  it('keeps unknown authored outline fields complete in the existing raw fallback', async () => {
    const { view, shown } = await preview('planTemplates', true, true);
    try {
      expect(shown).toContain('Unknown authored evidence');
      expect(shown).toContain('extensionWords');
      expect(shown).toContain('Opening words');
      expect(shown).toContain('Keep the subpoint reminder');
    } finally { view.unmount(); await act(settleEngine); }
  });
});
