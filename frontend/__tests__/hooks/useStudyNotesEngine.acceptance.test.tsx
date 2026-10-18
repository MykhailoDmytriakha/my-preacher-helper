import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { StudyNote } from '@/models/models';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner', isAuthLoading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('@/utils/clientId', () => ({ newClientId: () => 'note' }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'studyNotes', id: 'note' };
const initialValue = { userId: 'owner', title: 'Title', content: 'Original words', tags: [], scriptureRefs: [], type: 'note',
  isDraft: true, createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z', rev: { note: 4 } };

function setup(creating = false, id = resource.id) {
  const harness = documentEngineHarness({ resource: { ...resource, id }, value: creating ? null : initialValue,
    metadata: creating ? null : { protocol: 1, generation: 'g1', revision: 7, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, withCollections: true }));
  const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
  const hook = renderHook(() => useStudyNotesEngine(true), { wrapper });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const send = jest.mocked(harness.transport.send);
  const deliver = send.getMockImplementation()!;
  send.mockImplementation(async command => { await held; return deliver(command); });
  return { ...hook, harness, release };
}

describe('study-note exact server acceptance', () => {
  it('uses the reserved creation resource and confirms only its actual snapshot', async () => {
    const id = 'preallocated-note';
    const { result, harness, release, unmount } = setup(true, id);
    await waitFor(() => expect(result.current.loading).toBe(false));
    try {
      let submission!: ReturnType<typeof result.current.createNote>;
      const create: (value: Parameters<typeof result.current.createNote>[0], options?: { id: string; captureScope?: string }) => ReturnType<typeof result.current.createNote> = result.current.createNote;
      await act(async () => { submission = create({ userId: 'owner', title: 'Reserved', content: 'Authored words', tags: [], scriptureRefs: [], type: 'note', materialIds: [], relatedSermonIds: [] }, { id, captureScope: 'draft-capture:v1:reserved' }); });
      await settleEngine();
      expect(submission.note.id).toBe(id);
      const queued = (await harness.commits.list('owner'))[0];
      expect(queued.baseline.resource.id).toBe(id);
      expect(queued.retentionScope).toBe('draft-capture:v1:reserved');
      expect(queued.value?.content).toBe('Authored words');
      await expect(submission.capture).resolves.toMatchObject({ kind: 'submitted', requestId: queued.id });
      expect(result.current.confirmedCreationIds.has(id)).toBe(false);
      await act(async () => { release(); await harness.engine.retry(); await submission.persistence; await settleEngine(); });
      // The next opening reads canonical collection membership; local capture alone cannot mint it.
      await act(async () => { await result.current.refetch(); await settleEngine(); });
      await waitFor(() => expect(result.current.confirmedCreationIds.has(id)).toBe(true));
      expect(harness.server.resource.id).toBe(id);
      expect(harness.server.value?.content).toBe('Authored words');
    } finally { release(); await harness.engine.retry().catch(() => undefined); unmount(); }
  });

  it('carries update backup ownership into its durable request before server acceptance', async () => {
    const { result, harness, release, unmount } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    try {
      const update = result.current.updateNote as (input: Parameters<typeof result.current.updateNote>[0] & { captureScope: string }) => ReturnType<typeof result.current.updateNote>;
      let submission!: ReturnType<typeof update>;
      await act(async () => { submission = update({ id: 'note', updates: { content: 'Captured words' }, captureScope: 'draft-capture:v1:update' }); });
      await awaitAcceptance(submission, () => undefined);
      const [queued] = await harness.commits.list('owner');
      expect(queued.value?.content).toBe('Captured words');
      expect(queued.retentionScope).toBe('draft-capture:v1:update');
      expect(harness.server.value?.content).toBe('Original words');
    } finally { release(); await harness.engine.retry().catch(() => undefined); unmount(); }
  });

  it.each(['create', 'update', 'delete'] as const)('keeps %s persistence pending after local capture until this request is acknowledged', async kind => {
    const { result, harness, release, unmount } = setup(kind === 'create');
    await waitFor(() => expect(result.current.loading).toBe(false));
    let submission!: WriteSubmission & { result?: Promise<StudyNote & { revision?: number }> };
    try {
      await act(async () => {
        if (kind === 'create') submission = result.current.createNote({ userId: 'owner', title: 'Title', content: 'Submitted words',
          tags: [], scriptureRefs: [], type: 'note', materialIds: [], relatedSermonIds: [] });
        else if (kind === 'update') submission = result.current.updateNote({ id: 'note', updates: { content: 'Submitted words' } });
        else submission = result.current.deleteNote('note');
      });
      let persisted = false;
      void submission.persistence.then(() => { persisted = true; }, () => undefined);
      const acceptance = await awaitAcceptance(submission, () => undefined);
      await settleEngine();
      const requests = await harness.commits.list('owner');
      expect(requests).toHaveLength(1);
      expect(requests[0].state).not.toBe('acknowledged');
      expect(harness.server.value?.content ?? null).toBe(kind === 'create' ? null : 'Original words');
      expect(acceptance.kind).toBe('queued');
      expect(persisted).toBe(false);
      await act(async () => { release(); await harness.engine.retry(); await submission.persistence; await settleEngine(); });
      expect(persisted).toBe(true);
      expect(harness.server.value?.content ?? null).toBe(kind === 'delete' ? null : 'Submitted words');
      if (kind === 'update') {
        const saved = await submission.result!;
        expect(saved.content).toBe(harness.server.value?.content);
        expect(saved.revision).toBe((harness.server.value?.rev as { note: number }).note);
      }
    } finally {
      release(); await harness.engine.retry(); unmount();
    }
  });

  it('does not accept later words when the earlier submitted write is acknowledged', async () => {
    const { result, harness, release, unmount } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const send = jest.mocked(harness.transport.send);
    let releaseLater!: () => void;
    const laterHold = new Promise<void>(resolve => { releaseLater = resolve; });
    const deliver = send.getMockImplementation()!;
    send.mockImplementation(async command => {
      if (command.kind === 'update' && command.changes.some(change => change.after.value === 'Later words')) await laterHold;
      return deliver(command);
    });
    let first!: ReturnType<typeof result.current.updateNote>;
    let later!: ReturnType<typeof result.current.updateNote>;
    try {
      await act(async () => { first = result.current.updateNote({ id: 'note', updates: { content: 'First words' } }); await awaitAcceptance(first, () => undefined); });
      await act(async () => { later = result.current.updateNote({ id: 'note', updates: { content: 'Later words' } }); await awaitAcceptance(later, () => undefined); });
      let laterAccepted = false; void later.persistence.then(() => { laterAccepted = true; }, () => undefined);
      await act(async () => { release(); await first.persistence; await settleEngine(); });
      expect(harness.server.value?.content).toBe('First words');
      expect((await first.result).content).toBe('First words');
      expect(laterAccepted).toBe(false);
      await act(async () => { releaseLater(); await harness.engine.retry(); await later.persistence; });
      expect((await later.result).content).toBe('Later words');
    } finally { release(); releaseLater(); await harness.engine.retry(); unmount(); }
  });

  it('retains a refused update as recoverable work without accepting its text', async () => {
    const { result, harness, release, unmount } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    let submission!: WriteSubmission;
    try {
      await act(async () => { submission = result.current.updateNote({ id: 'note', updates: { content: 42 as never } }); });
      const outcome = submission.persistence.then(() => 'accepted', () => 'refused');
      release();
      await act(async () => { await harness.engine.retry(); await settleEngine(); });
      expect(await outcome).toBe('refused');
      expect(harness.server.value?.content).toBe('Original words');
      expect(await harness.engine.listRecoverable(resource)).toHaveLength(1);
    } finally { release(); await harness.engine.retry(); unmount(); }
  });
});
