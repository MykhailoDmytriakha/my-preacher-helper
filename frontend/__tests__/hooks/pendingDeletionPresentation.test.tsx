/** BUG-20261028-offline-deleted-rows-stay-in-lists: actual engine projection through public readers. */
import { renderHook } from '@testing-library/react';

import { collectionDocumentViews } from '@/data-engine/collectionView';
import { collectionRecordPresence } from '@/data-engine/recordPresence';
import type { CommitRequest } from '@/data-engine/commits';
import type { CollectionState } from '@/data-engine/collections';
import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';
import { useCouncilsDataCollection } from '@/hooks/useCouncilsDataCollection';
import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';
import { usePlanTemplates } from '@/hooks/usePlanTemplates';
import { usePrayerDetail } from '@/hooks/usePrayerDetail';
import { usePrayerRequestsEngine } from '@/hooks/usePrayerRequestsEngine';
import { useScriptureUsage } from '@/hooks/useScriptureUsage';
import { useSermonsDataCollection } from '@/hooks/useSermonsDataCollection';
import { useSeriesDataCollection } from '@/hooks/useSeriesDataCollection';
import { useServiceOrdersEngine } from '@/hooks/useServiceOrdersEngine';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { useTags } from '@/hooks/useTags';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';

const mockOwner = 'qa-owner';
const LIVE = 'live-row';
const DELETING = 'pending-delete-row';
const EDITING = 'ordinary-edit-row';
const TOMBSTONE = 'confirmed-tombstone-row';
const reference = { bible: 'kjv' as const, book: 'John', chapter: 3, fromVerse: 16 };

let mockStates: Record<string, CollectionState>;
const mockRefresh = jest.fn(async () => ({ complete: true, freshness: 'server', snapshots: [], documents: [] }));
const mockActions = { ready: true, create: jest.fn(), remove: jest.fn(), commit: jest.fn(), submit: jest.fn(), resolve: jest.fn() };

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn((collection: string | null) => ({
    state: collection ? mockStates[collection] : undefined, loading: false, error: null, refresh: mockRefresh,
    refreshPresence: jest.fn(), presence: (id: string) => collectionRecordPresence({collection: collection ?? '', id}, collection ? mockStates[collection] : null),
  })),
  useDocumentActions: jest.fn(() => mockActions),
}));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: mockOwner, isAuthLoading: false }) }));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/hooks/usePersistedConflict', () => ({ usePersistedConflict: () => [null, jest.fn(), jest.fn(), {}] }));
jest.mock('@/hooks/useConfirm', () => ({ useDiscardQuestion: () => ({ askBeforeDiscard: jest.fn(), discardDialog: null, withdraw: jest.fn() }) }));

type Adapter = { name: string; collection: string; useIds: () => string[] };

const values: Record<string, (id: string) => DocumentData> = {
  studyNotes: id => ({ userId: mockOwner, title: id, content: 'John 3:16', scriptureRefs: [{ ...reference, id: `${id}-ref` }], tags: [], materialIds: [], type: 'note', isDraft: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' }),
  groups: id => ({ userId: mockOwner, title: id, createdAt: '2026-01-01', updatedAt: '2026-01-01', meetingDates: [], flow: [], templates: [] }),
  series: id => ({ userId: mockOwner, title: id, createdAt: '2026-01-01', updatedAt: '2026-01-01', groups: [], sermons: [] }),
  sermons: id => ({ userId: mockOwner, title: id, createdAt: '2026-01-01', updatedAt: '2026-01-01', outline: [], tags: [], scriptureRefs: [] }),
  serviceOrders: id => ({ userId: mockOwner, title: id, rank: 1000, steps: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }),
  prayerRequests: id => ({ userId: mockOwner, title: id, description: '', createdAt: '2026-01-01', status: 'active', updates: [] }),
  planTemplates: id => ({ userId: mockOwner, name: id, structure: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }),
  tags: id => ({ userId: mockOwner, name: id, color: '#123456', required: false, createdAt: '2026-01-01' }),
  councils: id => ({ userId: mockOwner, title: id, topics: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' }),
};

function snapshot(collection: string, id: string, value: DocumentData | null, deleted = false): ResourceSnapshot {
  return { resource: { collection, id }, value, metadata: { protocol: 1, generation: `gen-${id}`, revision: 1, deleted } };
}
function request(collection: string, id: string, value: DocumentData | null, state: CommitRequest['state']): CommitRequest {
  const baseline = snapshot(collection, id, values[collection](id));
  return { id: `request-${id}`, owner: mockOwner, editorId: `editor-${id}`, editGeneration: 1,
    baseline, value, predecessor: null, revision: 1, initialized: false, working: baseline,
    intended: value, command: null, submitted: null, sequence: 0, state, result: null, unfinalized: [] };
}
function collectionState(collection: string, deletionState: 'queued' | 'refused' | 'cancelled'): CollectionState {
  const live = snapshot(collection, LIVE, values[collection](LIVE));
  const target = snapshot(collection, DELETING, values[collection](DELETING));
  const edit = snapshot(collection, EDITING, values[collection](EDITING));
  const tombstone = snapshot(collection, TOMBSTONE, null, true);
  const deletion = request(collection, DELETING, null, deletionState);
  const ordinaryEdit = request(collection, EDITING, { ...values[collection](EDITING), title: `${EDITING} edited` }, 'queued');
  const documents = collectionDocumentViews(mockOwner, collection, [live, target, edit, tombstone], [deletion, ordinaryEdit]);
  return { snapshots: [live, target, edit, tombstone], documents, complete: true, freshness: 'cache', checking: false, version: 1, error: null };
}

const adapters: Adapter[] = [
  { name: 'notes', collection: 'studyNotes', useIds: function useNoteIds() { return useStudyNotesEngine(true).notes.map(row => row.id); } },
  { name: 'groups', collection: 'groups', useIds: function useGroupIds() { return useGroupsDataCollection().groups.map(row => row.id); } },
  { name: 'series', collection: 'series', useIds: function useSeriesIds() { return useSeriesDataCollection(true, mockOwner).series.map(row => row.id); } },
  { name: 'sermons', collection: 'sermons', useIds: function useSermonIds() { return useSermonsDataCollection().sermons.map(row => row.id); } },
  { name: 'service orders', collection: 'serviceOrders', useIds: function useOrderIds() { return useServiceOrdersEngine(mockOwner, true).orders.map(row => row.id); } },
  { name: 'prayers', collection: 'prayerRequests', useIds: function usePrayerIds() { return usePrayerRequestsEngine(mockOwner, null, true).prayerRequests.map(row => row.id); } },
  { name: 'plan templates', collection: 'planTemplates', useIds: function useTemplateIds() { return usePlanTemplates(mockOwner).templates.map(row => row.id); } },
  { name: 'tags', collection: 'tags', useIds: function useTagIds() { return useTags(mockOwner).customTags.map(row => row.id); } },
  { name: 'councils', collection: 'councils', useIds: function useCouncilIds() { return useCouncilsDataCollection().councils.map(row => row.id); } },
  { name: 'scripture usage', collection: 'studyNotes', useIds: function useUsageIds() { return useScriptureUsage(reference, 'current-note', 'en').results.map(row => row.id); } },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockStates = Object.fromEntries(Object.keys(values).map(collection => [collection, collectionState(collection, 'queued')]));
  jest.mocked(useDocumentActions).mockReturnValue(mockActions as never);
  jest.mocked(useDataCollection).mockImplementation((collection: string | null) => ({
    state: collection ? mockStates[collection] : undefined, loading: false, error: null, refresh: mockRefresh,
    refreshPresence: jest.fn(), presence: (id: string) => collectionRecordPresence({collection: collection ?? '', id}, collection ? mockStates[collection] : null),
  }) as never);
});

describe.each(adapters)('$name public list projection', ({ collection, useIds }) => {
  it('keeps live and ordinary edited records, but hides an outstanding delete and confirmed tombstone', () => {
    const { result } = renderHook(useIds);
    const ids = result.current;
    expect(ids).toContain(LIVE);
    expect(ids).toContain(EDITING);
    expect(ids).not.toContain(DELETING);
    expect(ids).not.toContain(TOMBSTONE);
    // The read projection is not allowed to erase the underlying retry/recovery address.
    expect(mockStates[collection].documents?.find(row => row.resource.id === DELETING)).toMatchObject({
      value: values[collection](DELETING), pending: true, deleting: true,
    });
  });

  it('continues hiding a refused delete while preserving its value and attention state', () => {
    mockStates[collection] = collectionState(collection, 'refused');
    const { result } = renderHook(useIds);
    expect(result.current).not.toContain(DELETING);
    expect(mockStates[collection].documents?.find(row => row.resource.id === DELETING)).toMatchObject({
      value: values[collection](DELETING), pending: true, needsAttention: true, deleting: true,
    });
  });

  it('restores the confirmed record after its delete is cancelled', () => {
    mockStates[collection] = collectionState(collection, 'cancelled');
    const { result } = renderHook(useIds);
    expect(result.current).toContain(DELETING);
    expect(result.current).not.toContain(TOMBSTONE);
  });
});

it('retains council identities, including the address of a hidden delete and a tombstone', () => {
  const { result } = renderHook(() => useCouncilsDataCollection());
  expect(result.current.knownIds.has(DELETING)).toBe(true);
  expect(result.current.knownIds.has(TOMBSTONE)).toBe(true);
});

it('does not project another owner’s note into scripture usage', () => {
  const foreign = snapshot('studyNotes', 'foreign-note', { ...values.studyNotes('foreign-note'), userId: 'other-owner' });
  const own = snapshot('studyNotes', LIVE, values.studyNotes(LIVE));
  mockStates.studyNotes = { ...mockStates.studyNotes, snapshots: [own, foreign], documents: collectionDocumentViews(mockOwner, 'studyNotes', [own, foreign], []) };
  const { result } = renderHook(() => useScriptureUsage(reference, 'current-note', 'en'));
  expect(result.current.results.map(row => row.id)).toEqual([LIVE]);
});

it.each(['queued', 'refused'] as const)('does not keep a %s deleted prayer available as its ordinary detail', state => {
  mockStates.prayerRequests = collectionState('prayerRequests', state);
  const { result } = renderHook(() => usePrayerDetail(DELETING, mockOwner));
  expect(result.current.prayer).toBeNull();
  expect(result.current.presence).toMatchObject({kind:'deleting',source:'local',snapshot:{resource:{collection:'prayerRequests',id:DELETING}}});
  expect(mockStates.prayerRequests.documents?.find(row => row.resource.id === DELETING)).toMatchObject({
    value: values.prayerRequests(DELETING), deleting: true,
  });
});

it('preserves the actual raw deletion and ordinary-edit evidence independently of presentation', () => {
  for (const state of ['queued','refused'] as const) {
    const rows = collectionState('studyNotes',state).documents!;
    expect(rows.find(row => row.resource.id === DELETING)).toMatchObject({value:values.studyNotes(DELETING),pending:true,deleting:true,needsAttention:state==='refused'});
    expect(rows.find(row => row.resource.id === EDITING)).toMatchObject({value:{title:`${EDITING} edited`},pending:true,deleting:false});
  }
});
it('returns a prayer detail normally after its deletion is cancelled', () => {
  mockStates.prayerRequests = collectionState('prayerRequests','cancelled');
  const {result} = renderHook(() => usePrayerDetail(DELETING,mockOwner));
  expect(result.current.prayer?.id).toBe(DELETING);
  expect(result.current.presence).toMatchObject({kind:'present'});
});
