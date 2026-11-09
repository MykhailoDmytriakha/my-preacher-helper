import { act, fireEvent, render as renderComponent, renderHook, screen, within } from '@testing-library/react';
import React from 'react';

import UnreadableConflictDrafts from '@/components/UnreadableConflictDrafts';
import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { usePrayerRequestsEngine } from '@/hooks/usePrayerRequestsEngine';
import { PRAYER_CORE_AGGREGATE, PRAYER_STATUS_AGGREGATE } from '@/services/prayerRequests.client';
import { draftKey } from '@/utils/durableDraft';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useDocumentActions: jest.fn(),
}));

import type { DocumentTagBasis } from '@/data-engine/documentTagCapture';
import type { PrayerTitleSeen } from '@/data-engine/documentFieldAction';
import type { PrayerRequest } from '@/models/models';

const stored = { userId: 'u', title: 'Healing', description: 'Phone text', status: 'active', updates: [], createdAt: 'c', updatedAt: 'u', rev: { core: 2 } };
let current: Record<string, unknown> = stored;
const actions = {
  ready: true, captureActionTime: jest.fn(), create: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn(async (_resource: unknown, updater: (value: Record<string, unknown>) => Record<string, unknown>) => { current = updater(current); }),
};

function render() {
  jest.mocked(useDocumentActions).mockReturnValue(actions as never);
  jest.mocked(useDataCollection).mockReturnValue({ state: { snapshots: [], documents: [{ resource: { collection: 'prayerRequests', id: 'p1' }, value: stored }],
    complete: true, freshness: 'server', checking: false, version: 1, error: null }, loading: false, error: null, refresh: jest.fn() } as never);
  return renderHook(() => usePrayerRequestsEngine('u', 'p1', true));
}

describe('prayers on the engine', () => {
  it.each(['core', 'status'] as const)('keeps malformed %s words readable without applying them', kind => {
    const words = kind === 'core' ? 'Retained prayer words' : 'Retained answer words';
    const payload = kind === 'core' ? { id: 'p1', updates: { title: {}, description: words } }
      : { id: 'p1', status: {}, answerText: words };
    const aggregate = kind === 'core' ? PRAYER_CORE_AGGREGATE : PRAYER_STATUS_AGGREGATE;
    const key = draftKey('u', 'p1', `conflict:${aggregate}`, 'invalid');
    const raw = JSON.stringify({ savedAt: 1, value: { payload, actualRevision: 1 } });
    localStorage.setItem(key, raw);
    const hook = render();
    const choices = kind === 'core' ? hook.result.current.saveConflictChoices : hook.result.current.statusConflictChoices;
    const conflict = kind === 'core' ? hook.result.current.saveConflict : hook.result.current.statusConflict;
    expect(conflict).toBeNull();
    expect(choices.unreadableSources).toHaveLength(1);
    const view = renderComponent(<UnreadableConflictDrafts owner="u" sources={choices.unreadableSources} />);
    try {
      expect(screen.getByText(words)).toBeVisible();
      expect(actions.commit).not.toHaveBeenCalled();
      expect(localStorage.getItem(key)).toBe(raw);
    } finally { view.unmount(); hook.unmount(); }
  });

  beforeEach(() => { jest.clearAllMocks(); current = stored; window.localStorage.clear(); });

  it('refuses an edit of a field rewritten elsewhere, keeps the document, and keeping mine overwrites on purpose', async () => {
    const { result } = render();
    let error: unknown;
    await act(async () => { error = await result.current.updatePrayer('p1', { description: 'Laptop text' }, 1, { description: 'Old text' }).catch(e => e); });
    expect(isStaleWriteError(error)).toBe(true);
    expect(current.description).toBe('Phone text');
    expect(result.current.saveConflict).toEqual(expect.objectContaining({ payload: { id: 'p1', updates: { description: 'Laptop text' } } }));
    await act(async () => { await result.current.keepMineOnConflict(); });
    expect(current.description).toBe('Laptop text');
    expect(result.current.saveConflict).toBeNull();
  });

  it('saves an authored description without treating the untouched opening title as another rename', async () => {
    const { result } = render();
    await act(async () => { await result.current.updatePrayer('p1', { title: 'Opening title', description: 'New description', tags: undefined },
      1, { title: 'Opening title', description: 'Phone text', tags: [] }); });
    expect(current).toMatchObject({ title: 'Healing', description: 'New description' });
    expect(result.current.saveConflict).toBeNull();
  });

  it('adds the first tag to a prayer whose stored tags field is absent', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.updatePrayer('p1', { tags: ['First tag'] }, 2, { tags: [] }).catch(() => undefined);
    });
    expect(current).toMatchObject({ tags: ['First tag'], description: 'Phone text', title: 'Healing' });
    expect(result.current.saveConflict).toBeNull();
  });

  it.each([
    { opening: [], local: ['Local tag'], storedTags: ['Independent tag'], expected: ['Independent tag', 'Local tag'] },
    { opening: ['Opening tag'], local: undefined, storedTags: ['Opening tag', 'Independent tag'], expected: ['Independent tag'] },
  ])('keeps the independent tag when a form saves its own membership ($opening)', async ({ opening, local, storedTags, expected }) => {
    current = { ...stored, tags: storedTags };
    const { result } = render();
    const submit: (id: string, changes: Partial<PrayerRequest>, revision: number, baseline: Record<string, unknown>,
      seenTitle?: PrayerTitleSeen, seenTags?: DocumentTagBasis) => Promise<void> = result.current.updatePrayer;
    await act(async () => {
      await submit('p1', { tags: local }, 1, { tags: opening }, undefined, { generation: 'prayer', revision: 1 }).catch(() => undefined);
    });
    expect(current).toMatchObject({ tags: expected, description: 'Phone text' });
    expect(result.current.saveConflict).toBeNull();
  });

  it('recovers a refused description without removing the tags added elsewhere', async () => {
    current = { ...stored, tags: ['Opening tag', 'Independent tag'] };
    const first = render();
    await act(async () => {
      await first.result.current.updatePrayer('p1', { description: 'Laptop text', tags: undefined }, 1,
        { description: 'Opening text', tags: ['Opening tag'] }, undefined, { generation: 'prayer', revision: 1 })
        .catch(() => undefined);
    });
    expect(current).toMatchObject({ description: 'Phone text', tags: ['Opening tag', 'Independent tag'] });
    expect(first.result.current.saveConflict).not.toBeNull();
    first.unmount();
    current = { ...current, tags: ['Opening tag', 'Independent tag', 'Tag added after refusal'] };
    const recovered = render();
    await act(async () => { await recovered.result.current.keepMineOnConflict(); });
    expect(current).toMatchObject({ description: 'Laptop text', tags: ['Independent tag', 'Tag added after refusal'] });
    expect(recovered.result.current.saveConflict).toBeNull();
  });

  it.each(['description', 'tags'] as const)('keeps an explicit %s clear through a refused save and reload', async field => {
    current = { ...stored, tags: ['Server tag'] };
    const first = render();
    await act(async () => { await first.result.current.updatePrayer('p1', { [field]: undefined }, 1,
      { [field]: field === 'description' ? 'Opening text' : ['Opening tag'] }).catch(() => undefined); });
    expect(first.result.current.saveConflict).not.toBeNull();
    first.unmount();
    const second = render();
    await act(async () => { await second.result.current.keepMineOnConflict(); });
    expect(current[field]).toBeUndefined();
    expect(second.result.current.saveConflict).toBeNull();
  });

  it('keeps the refused text across leaving the screen, and retires it only when the resend lands', async () => {
    const first = render();
    await act(async () => { await first.result.current.updatePrayer('p1', { description: 'Laptop text' }, 1, { description: 'Old text' }).catch(() => undefined); });
    first.unmount();
    const second = render();
    expect(second.result.current.saveConflict).toEqual(expect.objectContaining({ payload: { id: 'p1', updates: { description: 'Laptop text' } } }));
    await act(async () => { await second.result.current.keepMineOnConflict(); });
    expect(current.description).toBe('Laptop text');
    second.unmount();
    expect(render().result.current.saveConflict).toBeNull();
  });

  it('asks before discarding a refused prayer edit, and cancel keeps its durable conflict', async () => {
    let latest!: ReturnType<typeof usePrayerRequestsEngine>;
    function Consumer() {
      latest = usePrayerRequestsEngine('u', 'p1', true);
      return <>{latest.discardDialog}<button onClick={() => void latest.takeTheirsOnConflict()}>take core</button></>;
    }
    renderComponent(<Consumer />);
    await act(async () => {
      await latest.updatePrayer('p1', { description: 'Laptop text' }, 1, { description: 'Old text' }).catch(() => undefined);
    });
    const pending = latest.saveConflict;

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'take core' })); });
    const dialog = await screen.findByRole('dialog');
    expect(latest.saveConflict).toBe(pending);
    await act(async () => { fireEvent.click(within(dialog).getAllByRole('button')[1]); });
    expect(latest.saveConflict).toBe(pending);
    expect(window.localStorage.length).toBeGreaterThan(0);
  });

  it('asks before discarding a refused prayer answer and confirms only that answer conflict', async () => {
    let latest!: ReturnType<typeof usePrayerRequestsEngine>;
    function Consumer() {
      latest = usePrayerRequestsEngine('u', 'p1', true);
      return <>{latest.discardDialog}<button onClick={() => void latest.takeTheirsOnStatusConflict()}>take answer</button></>;
    }
    renderComponent(<Consumer />);
    await act(async () => {
      await latest.setStatus('p1', 'answered', 'Laptop answer', undefined, { answerText: 'Old answer' }).catch(() => undefined);
    });
    const pending = latest.statusConflict;

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'take answer' })); });
    const dialog = await screen.findByRole('dialog');
    expect(latest.statusConflict).toBe(pending);
    await act(async () => { fireEvent.click(within(dialog).getAllByRole('button')[0]); });
    expect(latest.statusConflict).toBeNull();
    expect(latest.saveConflict).toBeNull();
    expect(current.answerText).toBeUndefined();
  });

  it('withdraws an open Take Theirs question when its prayer scope changes', async () => {
    let latest!: ReturnType<typeof usePrayerRequestsEngine>;
    function Consumer({ docId }: { docId: string }) {
      latest = usePrayerRequestsEngine('u', docId, true);
      return <>{latest.discardDialog}<button onClick={() => void latest.takeTheirsOnConflict()}>take core</button></>;
    }
    const view = renderComponent(<Consumer docId="p1" />);
    await act(async () => {
      await latest.updatePrayer('p1', { description: 'Laptop text' }, 1, { description: 'Old text' }).catch(() => undefined);
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'take core' })); });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    view.rerender(<Consumer docId="p2" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.length).toBeGreaterThan(0);
    expect(latest.saveConflict).toBeNull();
  });

  it('edits an existing answer without reopening a reactivated prayer or replacing the historical date', async () => {
    const old = '2026-10-03T10:00:00.000Z';
    current = { ...stored, status: 'active', answeredAt: old, answerText: 'Opening answer' };
    const { result } = render();
    await act(async () => { await result.current.setStatus('p1', 'answered', 'Edited answer', 1,
      { status: 'answered', answerText: 'Opening answer' },
      { status: 'answered', answeredAt: { exists: true, value: old }, generation: 'prayer', revision: 1 }); });
    expect(current).toMatchObject({ status: 'active', answeredAt: old, answerText: 'Edited answer' });
  });

  it('keeps an explicit edit to an existing answer text-only after a refusal and reload', async () => {
    const old = '2026-10-03T10:00:00.000Z';
    current = { ...stored, status: 'not_answered', answeredAt: old, answerText: 'Desktop answer' };
    const first = render();
    await act(async () => { await first.result.current.setStatus('p1', 'answered', 'Phone answer', 1,
      { status: 'answered', answerText: 'Opening answer' }).catch(() => undefined); });
    expect(first.result.current.statusConflict).not.toBeNull();
    first.unmount();
    const second = render();
    await act(async () => { await second.result.current.keepMineOnStatusConflict(); });
    expect(current).toMatchObject({ status: 'not_answered', answeredAt: old, answerText: 'Phone answer' });
  });

  it('marks an answer without replacing a newer note that was not authored by this action', async () => {
    current = { ...stored, answerText: 'New words from the desktop' };
    const { result } = render();
    await act(async () => { await result.current.setStatus('p1', 'answered', undefined, 0, { status: 'active', answerText: 'Old words' }); });
    expect(current).toMatchObject({ status: 'answered', answerText: 'New words from the desktop', answeredAt: expect.any(String) });
    expect(actions.commit).toHaveBeenCalledWith({ collection: 'prayerRequests', id: 'p1' }, expect.any(Function),
      { kind: 'prayer-status', status: { fields: ['status', 'answeredAt'], time: null } });
  });

  it('adds an update, answers the prayer and creates a new one through engine actions', async () => {
    const { result } = render();
    await act(async () => { await result.current.addUpdate('p1', 'Doctor visit went well'); });
    expect(current.updates).toEqual([expect.objectContaining({ text: 'Doctor visit went well' })]);
    await act(async () => { await result.current.setStatus('p1', 'answered', 'Healed'); });
    expect(current).toEqual(expect.objectContaining({ status: 'answered', answerText: 'Healed', answeredAt: expect.any(String) }));
    let created!: ReturnType<typeof result.current.createPrayer>;
    await act(async () => { created = result.current.createPrayer({ userId: 'u', title: 'New request' }); await created; });
    expect(actions.create).toHaveBeenCalledWith({ collection: 'prayerRequests', id: created.prayerId },
      expect.objectContaining({ userId: 'u', title: 'New request', status: 'active', updates: [] }));
  });
});
