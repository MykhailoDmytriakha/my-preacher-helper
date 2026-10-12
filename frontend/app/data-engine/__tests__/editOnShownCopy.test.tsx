import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { DocumentData } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

/**
 * WORDS TYPED ON THE COPY A SCREEN STILL SHOWED (BUG-20261011-refused-edit-words-not-recoverable).
 *
 * A deletion from another device reaches the editor's draft before the screen redraws (storage is
 * written first, the screen hears after). A keystroke in between was refused — every screen's
 * writer refuses a document that is not there — and the words lived only in the field, gone as
 * soon as the screen redrew. They are typing in progress when the deletion arrived, and must wait
 * the way such typing does: on the screen, with "deleted on another device" for the person to decide.
 */
const resource = { collection: 'sermons', id: 'sermon-1' };
const stored = { userId: 'owner', title: 'Grace', verse: 'John 1:14', date: '2026-09-01', thoughts: [], sourceNoteIds: [] };
/** What every screen writer does: a document that is not there is not edited. */
const owned = (edit: (current: DocumentData) => DocumentData) => (current: DocumentData | null) => {
  if (!current) throw new Error('The sermon is not available for editing');
  return edit(current);
};

function setup() {
  const harness = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
  return { harness, ...renderHook(({ open }: { open: boolean }) => useDataDocument(open ? resource : null), { wrapper, initialProps: { open: true } }) };
}

type Context = ReturnType<typeof setup>;

/** The render the person types on, once the document is on the screen. */
async function shownCopy(context: Context) {
  await waitFor(() => expect(context.result.current.data?.title).toBe('Grace'));
  return context.result.current;
}

/** The deletion reaches the engine; inside one act the screen keeps the render the person is typing on. */
async function deleteElsewhere(context: Context) {
  context.harness.silentRemoteDelete();
  await context.harness.engine.retry(resource); await settleEngine();
}

describe('words typed on the copy a screen still showed', () => {
  it('keep a change through the screen writer and wait under "deleted on another device"', async () => {
    const context = setup();
    let outcome: unknown;
    const shown = await shownCopy(context);
    await act(async () => {
      await deleteElsewhere(context);
      outcome = await shown.update(owned(current => ({ ...current, verse: 'Typed as it vanished' }))).then(() => 'kept', error => error);
      await settleEngine();
    });

    expect(outcome).toBe('kept');
    expect(context.result.current.data).toMatchObject({ title: 'Grace', verse: 'Typed as it vanished' });
    expect(context.result.current.status?.phase).toBe('deleted');
    expect(context.result.current.status?.canSave).toBe(false);
    expect(context.harness.server.value).toBeNull();
  });

  it('keep a whole new value and say the document is gone instead of an ordinary draft', async () => {
    const context = setup();
    const shown = await shownCopy(context);
    await act(async () => {
      await deleteElsewhere(context);
      await shown.edit({ ...shown.data!, verse: 'Typed as it vanished' });
      await settleEngine();
    });

    expect(context.result.current.data).toMatchObject({ verse: 'Typed as it vanished' });
    expect(context.result.current.status?.phase).toBe('deleted');
    expect(context.harness.server.value).toBeNull();
  });

  it('let the person drop the words for the deletion', async () => {
    const context = setup();
    const shown = await shownCopy(context);
    await act(async () => {
      await deleteElsewhere(context);
      await shown.update(owned(current => ({ ...current, verse: 'Typed as it vanished' })));
      await settleEngine();
    });
    expect(context.result.current.status?.canAcceptRemote).toBe(true);

    await act(async () => { await context.result.current.acceptRemote(); await settleEngine(); });
    expect(context.result.current.data).toBeNull();
    expect(context.result.current.status?.phase).toBe('deleted');
  });

  it('stay in the checkpoint left behind when the screen is left', async () => {
    const context = setup();
    const shown = await shownCopy(context);
    await act(async () => {
      await deleteElsewhere(context);
      await shown.update(owned(current => ({ ...current, verse: 'Typed as it vanished' })));
      await settleEngine();
    });
    // The screen is left; the engine stays.
    context.rerender({ open: false });
    await act(async () => { await settleEngine(); });

    const records = await context.harness.engine.listRecoverable(resource);
    expect(records.map(({ record }) => record.checkpoint.draft)).toEqual([expect.objectContaining({ verse: 'Typed as it vanished' })]);
    expect(context.harness.server.value).toBeNull();
  });

  it('do not bring back a document the person deleted on this screen', async () => {
    const context = setup();
    let outcome: unknown;
    const shown = await shownCopy(context);
    await act(async () => {
      await shown.remove();
      outcome = await shown.update(owned(current => ({ ...current, verse: 'Typed after deleting' }))).then(() => 'kept', error => error);
      await settleEngine();
    });

    expect(outcome).toBeInstanceOf(Error);
    await waitFor(async () => { await context.harness.engine.retry(); await settleEngine(); expect(context.harness.server.value).toBeNull(); });
  });
});
