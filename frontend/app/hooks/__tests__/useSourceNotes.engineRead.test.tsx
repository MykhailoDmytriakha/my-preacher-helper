import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { useSourceNotes } from '@/hooks/useSermonNoteLinks';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
// These relative imports match the destination frontend/app/hooks/__tests__ location.
import { settleEngine } from '../../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../../test-utils/membershipEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';
import type { Sermon } from '@/models/models';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
let mockOnline = true;
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));
jest.mock('@services/studies.service', () => ({
  NOTE_AGGREGATE: 'note',
}));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const noteResource = (id: string) => ({ collection: 'studyNotes', id });
const noteSnapshot = (id: string, title: string, revision = 1): ResourceSnapshot => ({
  resource: noteResource(id),
  metadata: { protocol: 1, generation: 'g', revision, deleted: false },
  value: {
    userId: 'owner', title, content: `Content for ${id}`, scriptureRefs: [], tags: [], type: 'analysis',
    createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
  },
});
const deletedSnapshot = (id: string): ResourceSnapshot => ({
  resource: noteResource(id),
  metadata: { protocol: 1, generation: 'g', revision: 2, deleted: true },
  value: null,
});
const sermon = (sourceNoteIds: string[]): Pick<Sermon, 'sourceNoteIds'> => ({ sourceNoteIds });

function setup(initial: ResourceSnapshot[], online: boolean) {
  mockOnline = online;
  const harness = membershipEngineHarness(initial);
  jest.mocked(createBrowserDataEngine).mockImplementation(() => {
    const browser = harness.createBrowser();
    browser.engine.setOnline(online);
    return browser;
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return <QueryClientProvider client={client}><DataEngineProvider>{children}</DataEngineProvider></QueryClientProvider>;
  };
  return { harness, Wrapper };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
});

describe('useSourceNotes reads the public study-note engine collection', () => {
  it('resolves cached engine rows offline in the sermon’s stored ID order', async () => {
    const { harness, Wrapper } = setup([noteSnapshot('n1', 'First'), noteSnapshot('n2', 'Second')], false);
    const { result, unmount } = renderHook(() => ({
      engine: useStudyNotesEngine(true),
      sources: useSourceNotes(sermon(['n2', 'n1'])),
    }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.engine.notes.map(note => note.id)).toEqual(['n1', 'n2']));
    expect(result.current.sources.notes.map(note => [note.id, note.title, note.content, note.type])).toEqual([
      ['n2', 'Second', 'Content for n2', 'analysis'],
      ['n1', 'First', 'Content for n1', 'analysis'],
    ]);
    expect(result.current.sources.missingIds).toEqual([]);
    expect(harness.collectionTransport.list).not.toHaveBeenCalled();
    unmount();
  });

  it('resolves a note created locally while offline from submitted engine state', async () => {
    const { harness, Wrapper } = setup([], false);
    const { result, unmount } = renderHook(() => ({
      engine: useStudyNotesEngine(true),
      sources: useSourceNotes(sermon(['offline-created'])),
    }), { wrapper: Wrapper });

    await act(async () => {
      const submitted = result.current.engine.createNote({
        userId: 'owner', title: 'Created offline', content: 'Locally authored content',
        scriptureRefs: [{ id: 'ref-1', book: 'John', chapter: 1, fromVerse: 1, toVerse: 1 }],
        tags: ['Study'], type: 'note',
      }, { id: 'offline-created' });
      await submitted.acceptance;
      await settleEngine();
    });

    await waitFor(() => expect(result.current.engine.notes.some(note =>
      note.id === 'offline-created' && note.title === 'Created offline' && note.type === 'note'
    )).toBe(true));
    await waitFor(() => expect(result.current.sources.notes).toHaveLength(1));
    expect(result.current.sources.notes[0]).toMatchObject({
      id: 'offline-created', title: 'Created offline', content: 'Locally authored content', type: 'note',
    });
    expect(result.current.sources.missingIds).toEqual([]);
    expect(harness.transport.send).not.toHaveBeenCalled();
    unmount();
  });

  it('keeps an unlisted ID unknown while the offline engine catalogue is incomplete', async () => {
    const { Wrapper } = setup([noteSnapshot('known', 'Known')], false);
    const { result, unmount } = renderHook(() => ({
      engine: useStudyNotesEngine(true),
      sources: useSourceNotes(sermon(['known', 'not-yet-known'])),
    }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.engine.notes.map(note => note.id)).toEqual(['known']));
    expect(result.current.sources.notes.map(note => note.id)).toEqual(['known']);
    expect(result.current.sources.missingIds).toEqual([]);
    unmount();
  });

  it('does not turn a locally pending delete into a confirmed missing link', async () => {
    const { Wrapper } = setup([noteSnapshot('n1', 'Known')], false);
    const { result, unmount } = renderHook(() => ({
      engine: useStudyNotesEngine(true),
      sources: useSourceNotes(sermon(['n1'])),
    }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.engine.notes.some(note => note.id === 'n1')).toBe(true));
    await act(async () => {
      await result.current.engine.deleteNote('n1').acceptance;
      await settleEngine();
    });

    await waitFor(() => expect(result.current.engine.notePresence('n1').kind).toBe('deleting'));
    expect(result.current.sources.missingIds).toEqual([]);
    unmount();
  });

  it('reports a linked ID absent only when a complete server list confirms its tombstone', async () => {
    const { harness, Wrapper } = setup([noteSnapshot('live', 'Live'), deletedSnapshot('deleted')], true);
    const { result, unmount } = renderHook(() => ({
      engine: useStudyNotesEngine(true),
      sources: useSourceNotes(sermon(['deleted', 'live'])),
    }), { wrapper: Wrapper });

    await waitFor(() => expect(harness.collectionTransport.list).toHaveBeenCalled());
    await waitFor(() => expect(result.current.engine.notePresence('deleted')).toMatchObject({ kind: 'absent', source: 'server' }));
    expect(result.current.sources.notes.map(note => note.id)).toEqual(['live']);
    expect(result.current.sources.missingIds).toEqual(['deleted']);
    unmount();
  });

  it('reports an unlisted ID absent only after a complete server answer', async () => {
    const { Wrapper } = setup([noteSnapshot('known', 'Known')], true);
    const { result, unmount } = renderHook(() => ({
      engine: useStudyNotesEngine(true),
      sources: useSourceNotes(sermon(['known', 'not-listed'])),
    }), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.engine.notePresence('not-listed')).toMatchObject({ kind: 'absent', source: 'server' }));
    expect(result.current.sources.notes.map(note => note.id)).toEqual(['known']);
    expect(result.current.sources.missingIds).toEqual(['not-listed']);
    unmount();
  });

  it('does not read the study-note collection when the sermon has no source IDs', async () => {
    const { harness, Wrapper } = setup([], true);
    const { result, unmount } = renderHook(() => useSourceNotes(sermon([])), { wrapper: Wrapper });

    expect(result.current).toEqual({ notes: [], missingIds: [], loading: false });
    await settleEngine();
    expect(harness.collectionTransport.list).not.toHaveBeenCalled();
    unmount();
  });
});
