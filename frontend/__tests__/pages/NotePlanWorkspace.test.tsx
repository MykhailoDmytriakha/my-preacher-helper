import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NotePlanWorkspace, NotePointActions, NoteNodeReminder } from '@/(pages)/(private)/sermons/[id]/plan/manual/NotePlanWorkspace';
import { generateNotePlanContent } from '@/(pages)/(private)/sermons/[id]/plan/planApi';

import type { ManualConspectus } from '@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus';
import type { Sermon } from '@/models/models';

let mockOnline = true;
let mockBlocked = false;
let mockLoading = false;
let mockMissing: string[] = [];
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));
jest.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => ({ aiBlocked: mockBlocked, refresh: async () => undefined }) }));
jest.mock('@/hooks/useSermonNoteLinks', () => ({ useSourceNotes: () => ({
  notes: [{ id: 'n', title: 'Study source' }], missingIds: mockMissing, loading: mockLoading,
}) }));
jest.mock('@/(pages)/(private)/sermons/[id]/plan/planApi', () => ({ generateNotePlanContent: jest.fn() }));

const point = { id: 'p', text: 'Who stood out?', note: 'List the people', subPoints: [{ id: 'sub', text: 'Their work', position: 0 }] };
const sermon = { id: 's', title: 'Title', verse: '', date: '', thoughts: [], userId: 'u', sourceNoteIds: ['n'],
  outline: { introduction: [], main: [point], conclusion: [] } } as Sermon;
const conspectus = { contentByNodeId: { p: 'Original words' }, modifiedNodeIds: { p: true }, pendingNodeIds: new Set(),
  restoreCells: jest.fn(), saveModified: jest.fn() } as unknown as ManualConspectus;

const view = (enabled = true) => render(<NotePlanWorkspace enabled={enabled} sermon={sermon} conspectus={conspectus}>
  <NotePointActions point={point} /><NoteNodeReminder text={point.note} /><NoteNodeReminder />
</NotePlanWorkspace>);

beforeEach(() => {
  jest.clearAllMocks(); mockOnline = true; mockBlocked = false; mockLoading = false; mockMissing = [];
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { p: '- Extracted people', sub: '' }, missingMaterial: { sub: 'No detail in source' } });
});

it('shows source, placed reminder, and the review before accepting a replacement', async () => {
  view();
  expect(screen.getByRole('link', { name: 'Study source' })).toHaveAttribute('target', '_blank');
  expect(screen.getByText('List the people')).toBeInTheDocument();
  expect(screen.getByText('plan.fromNote.noReminder')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'plan.fromNote.generatePoint' }));
  await screen.findByText('- Extracted people');
  expect(screen.getByText('Original words')).toBeInTheDocument();
  expect(screen.getByText('No detail in source')).toBeInTheDocument();
  expect(conspectus.restoreCells).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'plan.fromNote.apply' }));
  expect(conspectus.restoreCells).toHaveBeenCalledWith({ p: '- Extracted people' });
  fireEvent.click(screen.getByRole('button', { name: 'plan.fromNote.saveAll' }));
  expect(conspectus.saveModified).toHaveBeenCalled();
});

it('keeps the existing editor free of source controls when the mode is manual', () => {
  view(false);
  expect(screen.queryByRole('button', { name: 'plan.fromNote.generatePoint' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Study source' })).not.toBeInTheDocument();
});

it.each(['offline', 'usage', 'missing', 'loading'])('explains %s and disables generation', (reason) => {
  mockOnline = reason !== 'offline'; mockBlocked = reason === 'usage'; mockLoading = reason === 'loading'; mockMissing = reason === 'missing' ? ['gone'] : [];
  view();
  expect(screen.getByRole('button', { name: 'plan.fromNote.generatePoint' })).toBeDisabled();
});

it('shows request errors and allows dismissing a proposed replacement', async () => {
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(new Error('sourceTooLarge'));
  view();
  fireEvent.click(screen.getByRole('button', { name: 'plan.fromNote.generatePoint' }));
  await screen.findByText('plan.fromNote.sourceTooLarge');
  fireEvent.click(screen.getByRole('button', { name: 'plan.fromNote.generatePoint' }));
  await screen.findByText('- Extracted people');
  fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
  await waitFor(() => expect(screen.queryByText('- Extracted people')).not.toBeInTheDocument());
});
