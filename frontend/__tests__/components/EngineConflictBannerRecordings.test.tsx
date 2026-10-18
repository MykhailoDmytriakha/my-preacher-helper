import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
const mockTranslate = (key: string) => key;
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: mockTranslate, language: 'en' }) }));

let actions: ReturnType<typeof useDocumentActions> | null = null;
function Actions() { const current = useDocumentActions(); useEffect(() => { actions = current; }); return null; }
const resource = { collection: 'studyNotes', id: 'recording-recovery' };
const value = { userId: 'owner', title: 'Retained note', content: 'Accepted opening.', scriptureRefs: [], tags: [], type: 'note',
  createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' };
const words = 'Keep this dictated paragraph.\nAnother authored sentence.';
const metadata = { dictationSourceIds: ['private-dictation-source'], recordingSourceIds: ['private-recording-source'] };

beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'studyNotes'; actions = null; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

it.each([false, true].flatMap(screenOwned => ['conflict', 'refused'].map(outcome => [screenOwned, outcome] as const)))(
  'shows authored words without generated recording metadata in screen-owned=%s %s recovery', async (screenOwned, outcome) => {
    const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={25} /></DataEngineProvider>);
    await waitFor(() => expect(actions?.ready).toBe(true));
    const editor = screenOwned ? await harness.engine.openEditor(resource, editorIdentity('test-tab', resource, 'default', 'recording-page')) : null;
    if (outcome === 'conflict') harness.silentRemote({ content: 'Later accepted paragraph.' });
    else jest.mocked(harness.transport.send).mockImplementationOnce(async command => ({ kind: 'refused', operationId: command.operationId, code: 'permission-denied' }));
    await act(async () => {
      if (editor) { await editor.edit({ ...value, content: words, ...metadata }); await editor.save(); }
      else await actions!.commit(resource, current => ({ ...current!, content: words, ...metadata }));
      await settleEngine(); await settleEngine(); editor?.close({ flush: false });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Keep this dictated paragraph.'));
    const retained = await harness.engine.listRecoverable(resource);
    expect(retained.some(({ record }) => record.checkpoint.draft?.content === words
      && JSON.stringify(record.checkpoint.draft.dictationSourceIds) === JSON.stringify(metadata.dictationSourceIds)
      && JSON.stringify(record.checkpoint.draft.recordingSourceIds) === JSON.stringify(metadata.recordingSourceIds))).toBe(true);
    expect(harness.server.value?.content).toBe(outcome === 'conflict' ? 'Later accepted paragraph.' : value.content);
    if (screenOwned || outcome === 'refused') {
      const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      const secure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
      try {
        fireEvent.click(screen.getByRole('button', { name: 'freshness.copyTextAction' }));
        await waitFor(() => expect(writeText).toHaveBeenCalled());
        expect(writeText.mock.calls[0][0]).toContain(words);
        expect(writeText.mock.calls[0][0]).not.toMatch(/dictationSourceIds|recordingSourceIds|private-dictation-source|private-recording-source/);
      } finally {
        if (previous) Object.defineProperty(navigator, 'clipboard', previous); else Reflect.deleteProperty(navigator, 'clipboard');
        if (secure) Object.defineProperty(window, 'isSecureContext', secure); else Reflect.deleteProperty(window, 'isSecureContext');
      }
    }
    expect(screen.getByRole('alert').textContent).not.toMatch(/dictationSourceIds|recordingSourceIds|private-dictation-source|private-recording-source/);
    expect(screen.getByRole('alert')).toHaveTextContent('Another authored sentence.');
  },
);
