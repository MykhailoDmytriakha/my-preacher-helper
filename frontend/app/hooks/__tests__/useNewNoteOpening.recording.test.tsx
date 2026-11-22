import { renderHook, waitFor } from '@testing-library/react';

import { useNewNoteOpening } from '@/hooks/useNewStudyNoteDraft';
import { listRecordingDrafts } from '@/utils/recordingDraftStore';

import type { RecordingDraft } from '@/utils/recordingDraftStore';

let mockUid = 'owner';
const mockActions = { owner: 'owner', ready: true, knownStudyNoteCreation: jest.fn().mockResolvedValue(false) };
let mockSearch = new URLSearchParams();
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'new' }), useSearchParams: () => mockSearch }));
jest.mock('@/data-engine/react.client', () => ({ useDocumentActions: () => mockActions }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: mockUid }) }));
jest.mock('@/utils/recordingDraftStore', () => ({ listRecordingDrafts: jest.fn() }));

const reserved = 'reserved-note';
const ownedTake = { id: 'take', ownerId: 'owner', context: 'study', contextId: reserved } as RecordingDraft;
const oldUrl = window.location.href;
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  mockUid = 'owner';
  mockActions.owner = 'owner';
  mockSearch = new URLSearchParams({ draft: 'new~' + reserved, draftOwner: 'owner' });
  window.history.replaceState(null, '', '/studies/new?' + mockSearch);
});
afterEach(() => window.history.replaceState(null, '', oldUrl));

it('reopens the exact empty note address when its recording survived a reload', async () => {
  jest.mocked(listRecordingDrafts).mockResolvedValue([ownedTake]);
  const { result } = renderHook(useNewNoteOpening);
  await waitFor(() => expect(result.current.waiting).toBe(false));

  expect(result.current.draftDocId).toBe('new~' + reserved);
  expect(new URLSearchParams(location.search).get('draft')).toBe('new~' + reserved);
  expect(listRecordingDrafts).toHaveBeenCalledWith({ ownerId: 'owner', context: 'study', contextId: reserved });
});

it('reserves a blank editor when the matching owner has no durable note or recording', async () => {
  jest.mocked(listRecordingDrafts).mockResolvedValue([]);
  const { result } = renderHook(useNewNoteOpening);
  await waitFor(() => expect(result.current.waiting).toBe(false));

  expect(result.current.draftDocId).not.toBe('new~' + reserved);
});

it('never probes another owner’s opening while signed in to a different account', () => {
  mockUid = 'different-owner';
  mockActions.owner = mockUid;
  const { result } = renderHook(useNewNoteOpening);

  expect(result.current.draftDocId).not.toBe('new~' + reserved);
  expect(listRecordingDrafts).not.toHaveBeenCalled();
  expect(mockActions.knownStudyNoteCreation).not.toHaveBeenCalled();
});
