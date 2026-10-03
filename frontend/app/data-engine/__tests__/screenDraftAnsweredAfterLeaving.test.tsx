import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataEngineProvider, useDataDocument, useDocumentActions, waitsForDecision } from '@/data-engine/react.client';
import { describeSync } from '@/data-engine/status';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

/**
 * A SCREEN'S DRAFT ANSWERED AFTER THE SCREEN WAS LEFT (BUG-20260813-late-refusal-silent-after-navigation).
 *
 * Every opening of a screen is a new editor; the one that was left stays behind as a closed
 * checkpoint, and the screen opened again takes over its queued requests. When the person then
 * decides there, the work the closed checkpoint was waiting on is decided — it must stop waiting
 * (one-shot changes to the document answered "decide first" for ever) and stop being offered back,
 * unless it holds text typed beyond what it sent, which stays recoverable.
 */
const resource = { collection: 'sermons', id: 'sermon-1' };
const stored = { userId: 'owner', title: 'Grace', verse: 'John 1:14', date: '2026-09-01', thoughts: [], sourceNoteIds: ['note-a'] };
let opening = 0;
const screenId = () => editorIdentity('test-tab', resource, 'sermon', `screen-${++opening}`);

function setup() {
  const harness = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
  return { harness, wrapper, ...renderHook(() => useDocumentActions(), { wrapper }) };
}

type Context = ReturnType<typeof setup>;

const waiting = async ({ harness }: Context) => {
  const [records, journal] = await Promise.all([harness.engine.listRecoverable(resource), harness.engine.listPending()]);
  return records.filter(({ record }) => waitsForDecision(record, journal));
};

/** A screen saves, the phone has changed the same field, and the screen is left before the answer. */
async function conflictLeftBehind(context: Context, typedAfter?: string) {
  await waitFor(() => expect(context.result.current.ready).toBe(true));
  context.harness.silentRemote({ title: 'Written on the phone' });
  const left = await context.harness.engine.openEditor(resource, screenId());
  await act(async () => { await left.edit({ ...stored, title: 'Written on the laptop' }); await left.save(); await settleEngine(); await settleEngine(); });
  if (typedAfter) await act(async () => { await left.edit({ ...stored, title: 'Written on the laptop', verse: typedAfter }); await settleEngine(); });
  await act(async () => { left.close({ flush: true }); await settleEngine(); });
  expect(await waiting(context)).toHaveLength(1);
}

const oneShotWorks = async (context: Context) => {
  await act(async () => { await context.result.current.commit(resource, current => ({ ...current!, sourceNoteIds: ['note-a', 'note-b'] })); });
  await waitFor(async () => { await settleEngine(); expect(context.harness.server.value?.sourceNoteIds).toEqual(['note-a', 'note-b']); });
};

describe('a screen draft answered after the screen was left', () => {
  it('stops waiting once "keep mine" is chosen on the screen opened again', async () => {
    const context = setup();
    await conflictLeftBehind(context);
    const reopened = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await reopened.keepLocal(); await reopened.save(); await settleEngine(); await settleEngine(); });
    await waitFor(async () => { await settleEngine(); expect(context.harness.server.value?.title).toBe('Written on the laptop'); });

    expect(await waiting(context)).toHaveLength(0);
    expect(await context.harness.engine.listRecoverable(resource)).toHaveLength(0);
    await oneShotWorks(context);
    reopened.close({ flush: true });
  });

  it('stops waiting once "use server version" is chosen on the screen opened again', async () => {
    const context = setup();
    await conflictLeftBehind(context);
    const reopened = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await reopened.acceptRemote(); await settleEngine(); });

    expect(await waiting(context)).toHaveLength(0);
    expect(await context.harness.engine.listRecoverable(resource)).toHaveLength(0);
    await oneShotWorks(context);
    expect(context.harness.server.value?.title).toBe('Written on the phone');
    reopened.close({ flush: true });
  });

  it('keeps text typed after the answer on the left screen, recoverable and blocking nothing', async () => {
    const context = setup();
    await conflictLeftBehind(context, 'Typed after the conflict');
    const reopened = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await reopened.keepLocal(); await reopened.save(); await settleEngine(); await settleEngine(); });

    expect(await waiting(context)).toHaveLength(0);
    const recoverable = await context.harness.engine.listRecoverable(resource);
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0].record.checkpoint.draft?.verse).toBe('Typed after the conflict');
    await oneShotWorks(context);
    reopened.close({ flush: true });
  });

  it('a refusal: "use server version" on the screen opened again puts the stored text back', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    const left = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await left.edit({ ...stored, title: 42 as never }); await left.save(); await settleEngine(); await settleEngine(); left.close({ flush: true }); await settleEngine(); });
    expect(await waiting(context)).toHaveLength(1);

    const screen = renderHook(() => useDataDocument(resource), { wrapper: context.wrapper });
    await waitFor(() => expect(screen.result.current.status?.phase).toBe('refused'));
    expect(screen.result.current.status?.canAcceptRemote).toBe(true);
    await act(async () => { await screen.result.current.acceptRemote(); await settleEngine(); });

    await waitFor(() => expect(screen.result.current.data?.title).toBe('Grace'));
    expect(screen.result.current.status?.phase).not.toBe('refused');
    expect(await waiting(context)).toHaveLength(0);
    expect(await context.harness.engine.listRecoverable(resource)).toHaveLength(0);
    await oneShotWorks(context);
    expect(context.harness.server.value?.title).toBe('Grace');
  });

  /** Codex, round 1: the drop used to run after the choice resolved and took text typed meanwhile with it. */
  it('keeps a field typed while "use server version" is being carried out', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    const left = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await left.edit({ ...stored, title: 42 as never }); await left.save(); await settleEngine(); await settleEngine(); left.close({ flush: true }); await settleEngine(); });

    const screen = renderHook(() => useDataDocument(resource), { wrapper: context.wrapper });
    await waitFor(() => expect(screen.result.current.status?.phase).toBe('refused'));
    await act(async () => {
      const choosing = screen.result.current.acceptRemote();
      await screen.result.current.edit({ ...screen.result.current.data!, verse: 'Typed while choosing' });
      await choosing;
      await settleEngine();
    });

    await waitFor(() => expect(screen.result.current.data?.title).toBe('Grace'));
    expect(screen.result.current.data?.verse).toBe('Typed while choosing');
    expect(await waiting(context)).toHaveLength(0);
  });

  /** Codex, round 1: the left screen may still be open (another tab) when the new one decides. */
  it('stops waiting when the left screen is still open while another one decides', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    context.harness.silentRemote({ title: 'Written on the phone' });
    const source = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await source.edit({ ...stored, title: 'Written on the laptop' }); await source.save(); await settleEngine(); await settleEngine(); });

    const other = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await other.acceptRemote(); await settleEngine(); await settleEngine(); });
    expect(source.getState().checkpoint.conflicts).toHaveLength(0);
    expect(source.getState().checkpoint.draft?.title).toBe('Written on the phone');
    // Codex, round 2: its old conflict result went too, so later typing can be saved.
    expect(source.getState().result).toBeNull();
    await act(async () => { source.close({ flush: true }); other.close({ flush: true }); await settleEngine(); });

    expect(await waiting(context)).toHaveLength(0);
    expect(await context.harness.engine.listRecoverable(resource)).toHaveLength(0);
    await oneShotWorks(context);
  });

  /** Codex, round 1: two chains answered for one document — no screen takes either over. */
  it('lets the stored version be taken when no screen can decide', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    const first = await context.harness.engine.openEditor(resource, screenId());
    const second = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => {
      await first.edit({ ...stored, title: 41 as never }); await first.save();
      await second.edit({ ...stored, verse: 7 as never }); await second.save();
      await settleEngine(); await settleEngine();
      first.close({ flush: true }); second.close({ flush: true }); await settleEngine();
    });
    expect(await waiting(context)).toHaveLength(2);
    expect(await context.harness.engine.screenDecides(resource)).toBe(false);

    let taken = 0;
    await act(async () => { taken = await context.harness.engine.takeStoredVersion(resource); await settleEngine(); });
    expect(taken).toBe(2);
    expect(await waiting(context)).toHaveLength(0);
    expect(await context.harness.engine.listRecoverable(resource)).toHaveLength(0);
    await oneShotWorks(context);
    expect(context.harness.server.value?.title).toBe('Grace');
  });

  /**
   * Codex, round 2: a screen that saved twice before the first answer came back holds a conflict and a
   * request queued behind it. Taking the stored version cancels the answered one and sweeps the queued
   * one along — swept, not chosen — which left the conflict with nothing in flight, waiting for ever.
   */
  it('leaves nothing waiting for ever when taking the stored version sweeps queued work along', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    // Offline, so the screen's two saves (and another tab's) queue before any answer comes back.
    context.harness.engine.setOnline(false);
    const first = await context.harness.engine.openEditor(resource, screenId());
    const independent = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => {
      await first.edit({ ...stored, title: 'Written on the laptop' }); await first.save();
      await first.edit({ ...stored, title: 'Written on the laptop', verse: 'Queued behind the conflict' }); await first.save();
      await independent.edit({ ...stored, title: 'Written in a third tab' }); await independent.save();
      await settleEngine();
    });
    context.harness.silentRemote({ title: 'Written on the phone' });
    await act(async () => { context.harness.engine.setOnline(true); await context.harness.engine.retry(); await settleEngine(); await settleEngine(); });
    await act(async () => { first.close({ flush: false }); independent.close({ flush: false }); await settleEngine(); });
    expect(await context.harness.engine.screenDecides(resource)).toBe(false);
    expect((await waiting(context)).length).toBeGreaterThan(0);

    await act(async () => { await context.harness.engine.takeStoredVersion(resource); await settleEngine(); await settleEngine(); });
    expect(await waiting(context)).toHaveLength(0);
    await oneShotWorks(context);
    // The swept work was not chosen about: its text stays recoverable rather than vanishing.
    const left = await context.harness.engine.listRecoverable(resource);
    expect(left.map(({ record }) => record.checkpoint.draft?.verse)).toContain('Queued behind the conflict');
  });

  /**
   * Codex, round 2: a form saves only its fields, and dropping a refusal of the whole document left the
   * form's stage behind (reopening it failed). A refused form save is resolved by the form, as at HEAD.
   */
  it('does not offer the server version for a refused form save', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    const editor = await context.harness.engine.openEditor(resource, screenId());
    const form = editor.form('verse', [['verse']]);
    await act(async () => {
      await form.begin(); await form.update(value => ({ ...value, verse: 42 as never })); await form.save();
      await settleEngine(); await settleEngine();
    });
    expect(editor.getState().result?.kind).toBe('refused');
    expect(describeSync(editor.getState(), editor.getObservation(), editor.getDelivery()).canAcceptRemote).toBe(false);
    editor.close({ flush: false });
  });

  /**
   * Codex, round 3: a screen opened while a form still has its refused save open takes that request
   * over too. Offering the server version there cancelled the form's request, and the form's next save
   * failed. A form's work stays with the form, as at HEAD.
   */
  it('offers a second screen no server version for a form\'s refused save', async () => {
    const context = setup();
    await waitFor(() => expect(context.result.current.ready).toBe(true));
    const source = await context.harness.engine.openEditor(resource, screenId());
    const form = source.form('verse', [['verse']]);
    await act(async () => {
      await form.begin(); await form.update(value => ({ ...value, verse: 42 as never })); await form.save();
      await settleEngine(); await settleEngine();
    });
    const second = await context.harness.engine.openEditor(resource, screenId());
    await act(async () => { await settleEngine(); });
    expect(describeSync(second.getState(), second.getObservation(), second.getDelivery()).canAcceptRemote).toBe(false);
    expect(await context.harness.engine.formWorkPending(resource)).toBe(true);
    // Nor does the banner's choice for undecidable documents touch it.
    expect(await context.harness.engine.takeStoredVersion(resource)).toBe(0);
    expect((await context.harness.commits.list('owner')).some(request => request.state === 'cancelled')).toBe(false);
    second.close({ flush: false }); source.close({ flush: false });
  });
});
