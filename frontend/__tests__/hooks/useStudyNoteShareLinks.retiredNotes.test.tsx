import { act, renderHook } from '@testing-library/react';
import { useCallback } from 'react';

import { collectionRecordPresence } from '@/data-engine/recordPresence';
import { useDataCollection, useShareCapabilityActions } from '@/data-engine/react.client';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';

import type { CollectionState } from '@/data-engine/collections';
import type { DocumentData } from '@/data-engine/types';
import type { ResourceSnapshot } from '@/data-engine/types';
import type { StudyNoteShareLink } from '@/models/models';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(), useShareCapabilityActions: jest.fn(),
}));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: mockOwner, isAuthLoading: false }) }));
jest.mock('@/hooks/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'en' }) }));
jest.mock('@/hooks/useServerUnavailableNotice', () => ({ useServerUnavailableNotice: () => false }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

let mockOwner = 'owner';
let noteState: CollectionState | null;
let linkState: CollectionState;
let capability = { ready: true, actions: [], create: jest.fn(async () => undefined), revoke: jest.fn(async () => undefined), retry: jest.fn(async () => undefined) };
const noteSnapshot = (deleted = false, revision = 1): ResourceSnapshot => ({
  resource: { collection: 'studyNotes', id: 'note' },
  value: deleted ? null : { userId: mockOwner, content: 'Saved comment' },
  metadata: { protocol: 1, generation: 'generation', revision, deleted },
});
const collectionState = (collection: string, snapshots: ResourceSnapshot[] = []): CollectionState => ({
  snapshots, documents: [], complete: true, freshness: 'server', checking: false, version: 1, error: null,
});
const makeLinks = (ownerId = mockOwner): StudyNoteShareLink[] => ['note', 'other-note'].map(noteId => ({
  id: `link-${noteId}`, noteId, ownerId, token: `token-${noteId}`, createdAt: '2026-10-29T00:00:00Z', viewCount: 0,
}));
const linkStateFor = (rows: StudyNoteShareLink[]): CollectionState => ({
  ...collectionState('studyNoteShareLinks'),
  documents: rows.map(row => ({ resource: { collection: 'studyNoteShareLinks', id: row.id }, value: row as unknown as DocumentData, pending: false, needsAttention: false, deleting: false })),
  snapshots: rows.map(row => ({ resource: { collection: 'studyNoteShareLinks', id: row.id }, value: row as unknown as DocumentData, metadata: { protocol: 1, generation: 'links', revision: 1, deleted: false } })),
});
function useMockCollection(collection: string | null) {
  const state = collection === 'studyNotes' ? noteState : collection === 'studyNoteShareLinks' ? linkState : null;
  const presence = useCallback((id: string) => collectionRecordPresence({ collection: collection ?? '', id }, state), [collection, state]);
  return { state, presence, loading: false, readOnly: false, error: null,
    refresh: jest.fn(async () => state ?? collectionState(collection ?? '', [])), refreshPresence: jest.fn(async (id: string) => presence(id)) };
}

function setup() {
  const hook = renderHook(() => useStudyNoteShareLinks());
  return hook;
}
beforeEach(() => {
  jest.clearAllMocks(); mockOwner = 'owner'; noteState = collectionState('studyNotes', [noteSnapshot()]);
  linkState = linkStateFor(makeLinks());
  capability = { ready: true, actions: [], create: jest.fn(async () => undefined), revoke: jest.fn(async () => undefined), retry: jest.fn(async () => undefined) };
  jest.mocked(useDataCollection).mockImplementation(useMockCollection);
  jest.mocked(useShareCapabilityActions).mockImplementation(() => capability as never);
});

describe('share links after canonical note retirement', () => {
  it('removes only the retired note link from the canonical collection state', () => {
    const { result, rerender } = setup();
    expect(result.current.shareLinks).toEqual(makeLinks());
    noteState = collectionState('studyNotes', [noteSnapshot(true, 2)]); rerender();
    expect(result.current.shareLinks).toEqual([makeLinks()[1]]);
  });

  it('keeps an accepted retirement visible before the collection feed catches up', () => {
    noteState = {
      ...collectionState('studyNotes', [noteSnapshot()]),
      documents: [{ resource: noteSnapshot().resource, value: null, pending: false, deleting: false, needsAttention: false, acknowledged: noteSnapshot(true, 2) }],
    };
    expect(setup().result.current.shareLinks).toEqual([makeLinks()[1]]);
  });

  it('does not restore an old cached link when an accepted tombstone is read offline after reload', () => {
    noteState = { ...collectionState('studyNotes', [noteSnapshot(true, 2)]), freshness: 'cache', complete: false, error: 'offline' };
    expect(collectionRecordPresence(noteSnapshot().resource, noteState).kind).toBe('unknown');
    expect(setup().result.current.shareLinks).toEqual([makeLinks()[1]]);
  });

  it.each(['unknown', 'incomplete', 'complete-missing', 'failed'] as const)('does not infer retirement from a %s note list', kind => {
    noteState = kind === 'unknown' ? null : { ...collectionState('studyNotes', []), complete: kind === 'complete-missing', freshness: kind === 'incomplete' ? 'cache' : 'server', error: kind === 'failed' ? 'offline' : null };
    expect(setup().result.current.shareLinks).toEqual(makeLinks());
  });

  it('does not claim a live link is retired while its note delete awaits acknowledgement', () => {
    noteState = {
      ...collectionState('studyNotes', [noteSnapshot()]),
      documents: [{ resource: noteSnapshot().resource, value: noteSnapshot().value, pending: true, deleting: true, needsAttention: false }],
    };
    expect(collectionRecordPresence(noteSnapshot().resource, noteState).kind).toBe('deleting');
    expect(setup().result.current.shareLinks).toEqual(makeLinks());
  });

  it('does not revive a retired generation from an invalid later live acknowledgement', () => {
    noteState = {
      ...collectionState('studyNotes', [noteSnapshot(true, 2)]),
      documents: [{ resource: noteSnapshot().resource, value: noteSnapshot().value, pending: false, deleting: false, needsAttention: false, acknowledged: noteSnapshot(false, 3) }],
    };
    expect(setup().result.current.shareLinks).toEqual([makeLinks()[1]]);
  });

  it('does not apply the previous owner collection to the next owner link list', () => {
    noteState = collectionState('studyNotes', [noteSnapshot(true, 2)]);
    const { result, rerender } = setup();
    expect(result.current.shareLinks).toEqual([makeLinks()[1]]);
    mockOwner = 'next-owner'; noteState = null; linkState = linkStateFor(makeLinks()); rerender();
    expect(result.current.uid).toBe('next-owner');
    expect(result.current.shareLinks).toEqual(makeLinks());
  });

  it('keeps the filtered array identity when neither canonical presence nor links changed', () => {
    noteState = collectionState('studyNotes', [noteSnapshot(true, 2)]);
    const { result, rerender } = setup(); const first = result.current.shareLinks; rerender();
    expect(result.current.shareLinks).toBe(first);
  });

  it('does not expose a link for another owner even when it is in the collection snapshot', () => {
    linkState = linkStateFor([...makeLinks(), { ...makeLinks()[0], id: 'foreign-link', ownerId: 'foreign' }]);
    expect(setup().result.current.shareLinks).toEqual(makeLinks());
  });

  it('captures revoke locally through the public capability action facade', async () => {
    const { result } = setup();
    await act(async () => { await result.current.deleteShareLink('link-note'); });
    expect(capability.revoke).toHaveBeenCalledWith('link-note');
  });
});
