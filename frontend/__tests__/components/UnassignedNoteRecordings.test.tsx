import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import UnfinishedNoteDrafts from '../../app/(pages)/(private)/studies/components/UnfinishedNoteDrafts';
import { hasModalLayers } from '@/utils/modalLayerRegistry';
import { copyRecordingIntoNewNote } from '@/utils/studyNoteAudioRecovery';

import type { RecordingDraft } from '@/utils/recordingDraftStore';

const mockPush = jest.fn();
let mockOwner: string | undefined = 'alice';
let mockDrafts: RecordingDraft[] = [];
const mockRemove = jest.fn();
jest.mock('@/utils/modalLayerRegistry', () => ({
  ...jest.requireActual('@/utils/modalLayerRegistry'),
  hasModalLayers: jest.fn(() => false),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: mockOwner ? { uid: mockOwner } : null, loading: false }) }));
jest.mock('@/hooks/useRecordingDrafts', () => ({ useRecordingDrafts: () => ({ drafts: mockDrafts, loading: false, ownerId: mockOwner, removeDraft: mockRemove, refresh: jest.fn() }) }));
jest.mock('@/utils/studyNoteAudioRecovery', () => ({ ...jest.requireActual('@/utils/studyNoteAudioRecovery'), copyRecordingIntoNewNote: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const raw = (id = 'old-audio', contextId = 'new'): RecordingDraft => ({ id, ownerId: 'alice', blob: new Blob(['voice']), mimeType: 'audio/webm', sizeBytes: 5, createdAt: 1, context: 'study', contextId });
beforeEach(() => { mockOwner = 'alice'; mockDrafts = [raw()]; localStorage.clear(); jest.clearAllMocks(); });
afterEach(() => localStorage.clear());

it('offers unassigned audio without a text draft and copies only after its explicit action', async () => {
  jest.mocked(copyRecordingIntoNewNote).mockResolvedValue('/studies/new?draft=new~copy&draftOwner=alice');
  render(<UnfinishedNoteDrafts uid="alice" notes={[]} />);
  expect(screen.getByText('studiesWorkspace.unassignedAudio.title')).toBeInTheDocument();
  expect(document.querySelector('details')).not.toHaveAttribute('open');
  expect(copyRecordingIntoNewNote).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.unassignedAudio.copy', hidden: true }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/studies/new?draft=new~copy&draftOwner=alice'));
  expect(copyRecordingIntoNewNote).toHaveBeenCalledWith('old-audio', 'alice');
  expect(mockRemove).not.toHaveBeenCalled();
});

it('keeps linked or destination-owned sources out of the archive', () => {
  mockDrafts = [raw('linked'), raw('scoped', 'saved-note')];
  const view = render(<UnfinishedNoteDrafts uid="alice" notes={[{ id: 'saved-note', recordingSourceIds: ['linked'] }]} />);
  expect(screen.queryByText('studiesWorkspace.unassignedAudio.title')).not.toBeInTheDocument();
  view.unmount();
  localStorage.setItem('draft:v1:alice:new~future:note', JSON.stringify({ savedAt: 1, creationTargetId: 'future', value: { title: '', content: '', tags: [], scriptureRefs: [], type: 'note', recordingSourceIds: ['linked'] } }));
  mockDrafts = [raw('linked'), raw('scoped', 'future')];
  render(<UnfinishedNoteDrafts uid="alice" notes={[]} />);
  expect(screen.queryByText('studiesWorkspace.unassignedAudio.title')).not.toBeInTheDocument();
  expect(screen.getByText('studiesWorkspace.unfinished.recording')).toBeInTheDocument();
});

it('does not classify recordings while note discovery is incomplete', () => {
  render(<UnfinishedNoteDrafts uid="alice" notes={[]} canClassifyRecordings={false} />);
  expect(screen.queryByText('studiesWorkspace.unassignedAudio.title')).not.toBeInTheDocument();
});

it('retains the original and reports a refused copy without navigation', async () => {
  jest.mocked(copyRecordingIntoNewNote).mockRejectedValue(new Error('Storage refused'));
  render(<UnfinishedNoteDrafts uid="alice" notes={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.unassignedAudio.copy', hidden: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('audio.draft.resendFailed');
  expect(mockPush).not.toHaveBeenCalled(); expect(mockRemove).not.toHaveBeenCalled();
});

it('fences navigation after the active account changes while the copy waits', async () => {
  let finish!: (href: string) => void;
  jest.mocked(copyRecordingIntoNewNote).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<UnfinishedNoteDrafts uid="alice" notes={[]} />);
  const copy = screen.getByRole('button', { name: 'studiesWorkspace.unassignedAudio.copy', hidden: true });
  fireEvent.click(copy); fireEvent.click(copy);
  expect(copyRecordingIntoNewNote).toHaveBeenCalledTimes(1);
  mockOwner = 'bob'; view.rerender(<UnfinishedNoteDrafts uid="bob" notes={[]} />);
  await act(async () => { finish('/studies/new?draft=new~alice-copy&draftOwner=alice'); });
  expect(mockPush).not.toHaveBeenCalled(); expect(mockRemove).not.toHaveBeenCalled();
});

it.each([false, true])('waits for the list before navigating to copied audio (modal opened: %s)', async (modalOpened) => {
  const href = '/studies/new?draft=new~copy&draftOwner=alice';
  jest.mocked(copyRecordingIntoNewNote).mockResolvedValue(href);
  let navigate: (() => void) | undefined;
  const beforeNavigate = jest.fn((next: () => void) => { navigate = next; });
  render(<UnfinishedNoteDrafts uid="alice" notes={[]} beforeNavigate={beforeNavigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.unassignedAudio.copy', hidden: true }));
  await waitFor(() => expect(beforeNavigate).toHaveBeenCalledTimes(1));
  expect(mockPush).not.toHaveBeenCalled();
  jest.mocked(hasModalLayers).mockReturnValueOnce(modalOpened);
  act(() => navigate?.());
  if (modalOpened) expect(mockPush).not.toHaveBeenCalled();
  else expect(mockPush).toHaveBeenCalledWith(href);
  expect(mockRemove).not.toHaveBeenCalled();
});

it('shows the kept copy when the list changed while copying', async () => {
  let finish!: (href: string) => void;
  jest.mocked(copyRecordingIntoNewNote).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const oldNavigation = jest.fn();
  const newNavigation = jest.fn();
  const view = render(<UnfinishedNoteDrafts uid="alice" notes={[]} beforeNavigate={oldNavigation} />);
  fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.unassignedAudio.copy', hidden: true }));
  view.rerender(<UnfinishedNoteDrafts uid="alice" notes={[]} beforeNavigate={newNavigation} />);
  localStorage.setItem('draft:v1:alice:new~copy:note', JSON.stringify({ savedAt: 1, creationTargetId: 'copy',
    value: { title: 'Kept audio copy', content: '', tags: [], scriptureRefs: [], type: 'note', recordingSourceIds: ['old-audio'] } }));
  await act(async () => finish('/studies/new?draft=new~copy&draftOwner=alice'));
  expect(screen.getByRole('link', { name: /Kept audio copy/ })).toBeInTheDocument();
  expect(oldNavigation).not.toHaveBeenCalled();
  expect(newNavigation).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

it('keeps a newly opened editor in place when the audio copy finishes', async () => {
  let finish!: (href: string) => void;
  jest.mocked(copyRecordingIntoNewNote).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const beforeNavigate = jest.fn();
  render(<UnfinishedNoteDrafts uid="alice" notes={[]} beforeNavigate={beforeNavigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.unassignedAudio.copy', hidden: true }));
  localStorage.setItem('draft:v1:alice:new~copy:note', JSON.stringify({ savedAt: 1, creationTargetId: 'copy',
    value: { title: 'Audio kept for later', content: '', tags: [], scriptureRefs: [], type: 'note', recordingSourceIds: ['old-audio'] } }));
  jest.mocked(hasModalLayers).mockReturnValueOnce(true);
  await act(async () => finish('/studies/new?draft=new~copy&draftOwner=alice'));
  expect(screen.getByRole('link', { name: /Audio kept for later/ })).toBeInTheDocument();
  expect(beforeNavigate).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});
