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
const at = '2026-09-01T00:00:00.000Z';
const step = { id: 'changed-step', templateId: 'private-template', order: 1, durationMin: 5, instanceTitle: 'Opening step', instanceNotes: 'Keep the accepted note.' };
const group = { userId: 'owner', title: 'Home group', description: '', status: 'active', templates: [], flow: [step], meetingDates: [], createdAt: at, updatedAt: at };

async function preview(collection: string, field: string, value: DocumentData, local: DocumentData[string], remote: DocumentData[string], screenOwned = false) {
  const resource = { collection, id: 'scalar-choice' };
  const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={25} /></DataEngineProvider>);
  await waitFor(() => expect(actions?.ready).toBe(true));
  harness.silentRemote({ [field]: remote });
  const editor = screenOwned ? await harness.engine.openEditor(resource, editorIdentity('test-tab', resource, 'default', 'scalar-page')) : null;
  await act(async () => {
    if (editor) { await editor.edit({ ...value, [field]: local }); await editor.save(); }
    else await actions!.commit(resource, current => ({ ...current!, [field]: local }));
    await settleEngine(); await settleEngine();
  });
  editor?.close({ flush: false });
  await screen.findByText(screenOwned ? 'dataSync.screenDraftBody' : 'freshness.conflictTitle');
  const labels = field === 'steps' ? ['steps', 'legacyRecovery.field.steps'] : [`legacyRecovery.field.${field}`];
  const shown = screen.getByText(content => labels.some(label => content.startsWith(`${label}: `))).textContent ?? '';
  expect(shown).toContain('Opening step');
  expect(shown).not.toMatch(/changed-step|private-template|order:|updatedAt/);
  expect(harness.server.value?.[field]).toEqual(remote);
  expect(harness.server.value?.title).toBe(value.title);
  return shown;
}

const durationPreview = (durationMin: number | null, screenOwned = false) => preview('groups', 'flow', group, [{ ...step, durationMin }], [{ ...step, durationMin: 8 }], screenOwned);

describe('authored scalar values in saved-version choices', () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'groups,councils,serviceOrders'; actions = null; });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  it.each([12, 0])('shows a changed duration of %s with its step, label and unit', async duration => {
    expect(await durationPreview(duration)).toBe(`legacyRecovery.field.flow: Opening step\nlegacyRecovery.field.duration: ${duration} groupFlow.minutesShort`);
  });

  it('makes an explicitly cleared duration identifiable', async () => {
    expect(await durationPreview(null)).toContain('Opening step\nlegacyRecovery.field.duration: legacyRecovery.absent');
  });

  it('shows duration decisions owned by a screen after that screen is closed', async () => {
    expect(await durationPreview(12, true)).toContain('legacyRecovery.field.duration: 12 groupFlow.minutesShort');
  });

  it('copies the same labelled duration that the person reviewed', async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const secure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    try {
      const shown = await durationPreview(null, true);
      expect(shown).toContain('legacyRecovery.field.duration: legacyRecovery.absent');
      fireEvent.click(screen.getByText('freshness.copyTextAction'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(shown));
    } finally {
      if (previous) Object.defineProperty(navigator, 'clipboard', previous); else Reflect.deleteProperty(navigator, 'clipboard');
      if (secure) Object.defineProperty(window, 'isSecureContext', secure); else Reflect.deleteProperty(window, 'isSecureContext');
    }
  });

  it.each([true, false])('names a changed service-order mark when it becomes %s', async flagged => {
    const item = { id: 'changed-step', title: 'Opening step', body: 'Keep these words.', flagged: !flagged };
    const value = { userId: 'owner', title: 'Sunday service', steps: [item], rank: 1, createdAt: at, updatedAt: at };
    const shown = await preview('serviceOrders', 'steps', value, [{ ...item, flagged }], []);
    expect(shown).toContain(`Opening step\nserviceOrders.flag: legacyRecovery.${flagged ? 'valueOn' : 'valueOff'}`);
    expect(shown).toContain('legacyRecovery.field.steps: Opening step');
    expect(shown).not.toContain('Keep these words.');
  });

  it.each([true, false])('names the council assembly choice when it becomes %s', async forAssembly => {
    const item = { id: 'changed-step', title: 'Opening step', summary: 'Keep these words.', questions: [], options: [], forAssembly: !forAssembly };
    const value = { userId: 'owner', title: 'Council', status: 'preparing', topics: [item], createdAt: at, updatedAt: at };
    const shown = await preview('councils', 'topics', value, [{ ...item, forAssembly }], []);
    expect(shown).toContain(`Opening step\ncouncil.topic.forAssembly: legacyRecovery.${forAssembly ? 'valueOn' : 'valueOff'}`);
  });

  it('keeps an unchanged duration quiet when only the leader note changed', async () => {
    const shown = await preview('groups', 'flow', group, [{ ...step, instanceNotes: 'Newly authored note.' }], []);
    expect(shown).toContain('Opening step\nNewly authored note.');
    expect(shown).not.toContain('groupFlow.minutesShort');
  });
});
