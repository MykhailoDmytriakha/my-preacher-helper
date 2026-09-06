import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NotePlanWorkspace, NotePointActions, NotePointGenerateButton, NoteNodeReminder } from '@/(pages)/(private)/sermons/[id]/plan/manual/NotePlanWorkspace';
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
  <h3><NotePointGenerateButton point={point} section="main" /></h3><NotePointActions point={point} /><NoteNodeReminder text={point.note} /><NoteNodeReminder />
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
  expect(conspectus.saveModified).not.toHaveBeenCalled();
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

it('removes the bulk generation, bulk save and draft-help row', () => {
  view();
  expect(screen.queryByRole('button', { name: /plan.fromNote.fillEmpty/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'plan.fromNote.saveAll' })).not.toBeInTheDocument();
  expect(screen.queryByText('plan.fromNote.draftHelp')).not.toBeInTheDocument();
});

it('keeps other point buttons available while one or both requests are running', async () => {
  const next = { id: 'q', text: 'Next' };
  jest.mocked(generateNotePlanContent).mockReturnValue(new Promise(() => undefined));
  render(<NotePlanWorkspace enabled sermon={{ ...sermon, outline: { introduction: [point], main: [next], conclusion: [] } }} conspectus={conspectus}>
    <h3 data-testid="first-heading"><NotePointGenerateButton point={point} section="introduction" /></h3>
    <h3 data-testid="next-heading"><NotePointGenerateButton point={next} section="main" /></h3>
  </NotePlanWorkspace>);
  const [first, second] = screen.getAllByRole('button', { name: 'plan.fromNote.generatePoint' });
  expect(first).toHaveStyle({ backgroundColor: '#f59e0b' });
  expect(second).toHaveStyle({ backgroundColor: '#3b82f6' });
  expect(first).toHaveClass('section-button', 'h-8');
  fireEvent.click(first);
  expect(first).toBeDisabled();
  expect(first).toHaveAttribute('aria-busy', 'true');
  expect(second).toBeEnabled();
  fireEvent.click(second);
  expect(second).toBeDisabled();
  expect(second).toHaveAttribute('aria-busy', 'true');
  expect(generateNotePlanContent).toHaveBeenCalledTimes(2);
});

describe('scratch reminder disclosure', () => {
  it('starts open without a plan and supports manual folding in either direction', () => {
    render(<NoteNodeReminder text={'First line\nSecond line'} />);
    const toggle = screen.getByRole('button', { name: 'scratch.card.label' });
    const content = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(content).toBeVisible();
    expect(content).toHaveTextContent('First line Second line');
    expect(content).toHaveClass('whitespace-pre-wrap', 'italic');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(content).not.toBeVisible();
    fireEvent.click(toggle);
    expect(content).toBeVisible();
  });

  it('starts folded with a plan and preserves manual expansion across unrelated rerenders', () => {
    const { rerender } = render(<NoteNodeReminder text="Original reminder" hasPlan />);
    const toggle = screen.getByRole('button', { name: 'scratch.card.label' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Original reminder')).not.toBeVisible();
    fireEvent.click(toggle);
    rerender(<NoteNodeReminder text="Updated reminder" hasPlan />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Updated reminder')).toBeVisible();
  });

  it('folds when current content is first applied and reopens when the plan is cleared', () => {
    const { rerender } = render(<NoteNodeReminder text="Source material" hasPlan={false} />);
    expect(screen.getByText('Source material')).toBeVisible();
    rerender(<NoteNodeReminder text="Source material" hasPlan />);
    expect(screen.getByText('Source material')).not.toBeVisible();
    rerender(<NoteNodeReminder text="Source material" hasPlan={false} />);
    expect(screen.getByText('Source material')).toBeVisible();
  });

  it('keeps sibling disclosures independent and gives them distinct accessible targets', () => {
    const { rerender } = render(<>
      <NoteNodeReminder text="Parent reminder" hasPlan />
      <NoteNodeReminder text="Child reminder" hasPlan={false} />
    </>);
    const [parent, child] = screen.getAllByRole('button', { name: 'scratch.card.label' });
    expect(parent.getAttribute('aria-controls')).not.toBe(child.getAttribute('aria-controls'));
    fireEvent.click(parent);
    rerender(<>
      <NoteNodeReminder text="Parent reminder" hasPlan />
      <NoteNodeReminder text="Child reminder" hasPlan />
    </>);
    expect(screen.getByText('Parent reminder')).toBeVisible();
    expect(screen.getByText('Child reminder')).not.toBeVisible();
  });

  it.each([undefined, '', '  \n '])('shows guidance without an empty toggle for %p', (text) => {
    render(<NoteNodeReminder text={text} hasPlan />);
    expect(screen.getByText('plan.fromNote.noReminder')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'scratch.card.label' })).not.toBeInTheDocument();
  });
});
