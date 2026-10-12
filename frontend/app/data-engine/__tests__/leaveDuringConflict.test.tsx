import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

/**
 * THE LAST EDIT OF A SCREEN THAT IS LEFT AT ONCE (BUG-20261011-leave-during-conflict-loses-edit).
 *
 * A keystroke reaches the editor's draft at once and the device's storage a moment later. When the
 * screen closes inside that moment, the editor is gone before its checkpoint is written. Leaving
 * with nothing waiting turns the draft into a request; leaving while the person still has to decide
 * (a conflict, a refusal) or from a screen without autosave sends nothing — and then the checkpoint
 * left behind is the only place the words live. It must hold what the screen showed last.
 */
const resource = { collection: 'sermons', id: 'sermon-1' };
const stored = { userId: 'owner', title: 'Grace', verse: 'John 1:14', date: '2026-09-01', thoughts: [], sourceNoteIds: [] };
let opening = 0;
const screenId = () => editorIdentity('test-tab', resource, 'sermon', `screen-${++opening}`);

function setup() {
  const harness = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
  return { harness, ...renderHook(() => useDocumentActions(), { wrapper }) };
}

type Context = ReturnType<typeof setup>;

const recoverable = async ({ harness }: Context) => (await harness.engine.listRecoverable(resource)).map(({ record }) => record.checkpoint.draft);

describe('the last edit of a screen left at once', () => {
  it('stays in the checkpoint left behind while a conflict waits for the person', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    context.harness.silentRemote({ title: 'Written on the phone' });
    const left = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await left.edit({ ...stored, title: 'Written on the laptop' }); await left.save(); await settleEngine(); await settleEngine(); });
    expect(left.getState().checkpoint.conflicts.length).toBeGreaterThan(0);

    // Typed into another field and left in the same moment: nothing awaits the keystroke.
    await act(async () => {
      void left.edit({ ...stored, title: 'Written on the laptop', verse: 'Typed during the conflict' }).catch(() => undefined);
      left.close({ flush: true });
      await settleEngine();
    });

    expect(await recoverable(context)).toEqual([expect.objectContaining({ title: 'Written on the laptop', verse: 'Typed during the conflict' })]);
  });

  it('stays in the checkpoint left behind while a refusal waits for the person', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    const left = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await left.edit({ ...stored, title: 42 as never }); await left.save(); await settleEngine(); await settleEngine(); });
    expect(left.getState().result?.kind).toBe('refused');

    await act(async () => {
      void left.edit({ ...stored, title: 42 as never, verse: 'Typed after the refusal' }).catch(() => undefined);
      left.close({ flush: true });
      await settleEngine();
    });

    expect(await recoverable(context)).toEqual([expect.objectContaining({ verse: 'Typed after the refusal' })]);
  });

  it('stays in the checkpoint left behind by a screen that saves only on request', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    const left = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await left.edit({ ...stored, verse: 'First words' }); await settleEngine(); });

    await act(async () => {
      void left.edit({ ...stored, verse: 'First words and the last ones' }).catch(() => undefined);
      left.close({ flush: false });
      await settleEngine();
    });

    expect(await recoverable(context)).toEqual([expect.objectContaining({ verse: 'First words and the last ones' })]);
    expect(context.harness.transport.send).not.toHaveBeenCalled();
  });

  it('offers nothing back when the last edit took the words out again', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    const left = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await left.edit({ ...stored, verse: 'Words removed again' }); await settleEngine(); });

    await act(async () => {
      void left.edit({ ...stored }).catch(() => undefined);
      left.close({ flush: true });
      await settleEngine();
    });

    expect(await recoverable(context)).toEqual([]);
    expect(context.harness.server.value?.verse).toBe('John 1:14');
  });

  it('stays with the account that typed it when the account changes before the screen closes', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    const left = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await left.edit({ ...stored, verse: 'First words' }); await settleEngine(); });

    // Signing out reaches the engine before the screen's own cleanup runs.
    await act(async () => {
      void left.edit({ ...stored, verse: 'First words and the last ones' }).catch(() => undefined);
      context.harness.engine.setOwner('someone-else');
      left.close({ flush: false });
      await settleEngine();
    });
    expect(await context.harness.engine.listRecoverable()).toEqual([]);

    await act(async () => { context.harness.engine.setOwner('owner'); await settleEngine(); });
    expect(await recoverable(context)).toEqual([expect.objectContaining({ verse: 'First words and the last ones' })]);
  });

  it('still turns a draft with nothing waiting into a request as the screen closes', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    const left = await context.harness.engine.openEditor(resource, screenId());

    await act(async () => {
      void left.edit({ ...stored, verse: 'Sent on leaving' }).catch(() => undefined);
      left.close({ flush: true });
      await settleEngine();
    });

    await waitFor(async () => { await context.harness.engine.retry(); await settleEngine(); expect(context.harness.server.value?.verse).toBe('Sent on leaving'); });
    expect(await recoverable(context)).toEqual([]);
  });
});
