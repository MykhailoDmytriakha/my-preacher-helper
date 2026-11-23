import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { NoteNodeText, NotePlanWorkspace, NotePointActions, NotePointGenerateButton, NoteNodeReminder } from '@/(pages)/(private)/sermons/[id]/plan/manual/NotePlanWorkspace';
import { generateNotePlanContent } from '@/(pages)/(private)/sermons/[id]/plan/planApi';
import { beginProposal } from '@/(pages)/(private)/sermons/[id]/plan/manual/notePlanDrafts.client';

import type { ManualConspectus } from '@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus';
import type { Sermon } from '@/models/models';

let mockOnline = true;
let mockBlocked = false;
let mockLoading = false;
let mockMissing: string[] = [];
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));
jest.mock('@/hooks/useAiUsage', () => ({
  useAiUsage: () => require('@test-utils/aiUsage').aiUsageStub({ aiBlocked: mockBlocked }),
}));
jest.mock('@/hooks/useSermonNoteLinks', () => ({ useSourceNotes: () => ({
  notes: [{ id: 'n', title: 'Study source' }], missingIds: mockMissing, loading: mockLoading,
}) }));
jest.mock('@/(pages)/(private)/sermons/[id]/plan/planApi', () => ({ generateNotePlanContent: jest.fn() }));

const point = { id: 'p', text: 'Who stood out?', note: 'List the people', subPoints: [{ id: 'sub', text: 'Their work', position: 0 }] };
const sermon = { id: 's', title: 'Title', verse: '', date: '', thoughts: [], userId: 'u', sourceNoteIds: ['n'],
  outline: { introduction: [], main: [point], conclusion: [] } } as Sermon;
const conspectus = { contentByNodeId: { p: 'Original words' }, modifiedNodeIds: { p: true }, pendingNodeIds: new Set(), busyNodeIds: new Set(), isTransferringText: () => false,
  applyProposal: jest.fn(async () => true), saveModified: jest.fn() } as unknown as ManualConspectus;

const requestRefinement = () => {
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.open' }));
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.presets.rewrite' }));
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
};

// Each cell's own text sits inside `NoteNodeText`, exactly as the plan page renders it.
const view = (enabled = true) => render(<NotePlanWorkspace enabled={enabled} sermon={sermon} conspectus={conspectus}>
  <h3><NotePointGenerateButton point={point} section="main" /></h3><NotePointActions point={point} /><NoteNodeReminder text={point.note} /><NoteNodeReminder />
  <div data-testid="cell-p"><NoteNodeText point={point} nodeId="p"><p>Original words</p></NoteNodeText></div>
  <div data-testid="cell-sub"><NoteNodeText point={point} nodeId="sub"><p>No text yet</p></NoteNodeText></div>
</NotePlanWorkspace>);

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks(); mockOnline = true; mockBlocked = false; mockLoading = false; mockMissing = [];
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { p: '- Extracted people', sub: '' }, missingMaterial: { sub: 'No detail in source' } });
});

it('shows the placed reminder and the review before accepting a replacement', async () => {
  view();
  // The way INTO the study is a chip in the page header now, next to the title, exactly as the
  // sermon carries it. Nothing about the source is drawn here while the work can proceed.
  expect(screen.queryByRole('link', { name: 'Study source' })).not.toBeInTheDocument();
  expect(screen.queryByText('plan.fromNote.sourceUnavailable')).not.toBeInTheDocument();
  expect(screen.getByText('List the people')).toBeInTheDocument();
  expect(screen.getByText('plan.fromNote.noReminder')).toBeInTheDocument();
  requestRefinement();
  // The new version stands beside the cell's own text, which is shown ONCE — no "Now" copy above it.
  expect(await within(screen.getByTestId('cell-p')).findByText('- Extracted people')).toBeInTheDocument();
  expect(screen.getAllByText('Original words')).toHaveLength(1);
  expect(within(screen.getByTestId('cell-p')).getByText('plan.fromNote.current')).toBeInTheDocument();
  expect(screen.queryByText('plan.fromNote.proposal')).not.toBeInTheDocument();
  expect(within(screen.getByTestId('cell-sub')).getByText('No detail in source')).toBeInTheDocument();
  // The choice buttons stand once, under the last cell the version covers.
  expect(within(screen.getByTestId('cell-p')).queryByRole('button', { name: 'plan.fromNote.apply' })).not.toBeInTheDocument();
  expect(conspectus.applyProposal).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByTestId('cell-sub')).getByRole('button', { name: 'plan.fromNote.apply' }));
  expect(conspectus.applyProposal).toHaveBeenCalledWith({ p: '- Extracted people' },
    { p: 'Original words', sub: '' }, expect.any(Function));
});

it('writes an empty point straight in — no review, no "Generating…" box beside the spinning button', async () => {
  let resolve!: (value: { contentByNodeId: Record<string, string>; missingMaterial: Record<string, string> }) => void;
  jest.mocked(generateNotePlanContent).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const empty = { ...conspectus, contentByNodeId: {}, modifiedNodeIds: {} } as unknown as ManualConspectus;
  render(<NotePlanWorkspace enabled sermon={sermon} conspectus={empty}>
    <h3><NotePointGenerateButton point={point} section="main" /></h3><NotePointActions point={point} />
    <NoteNodeText point={point} nodeId="p"><p>No text yet</p></NoteNodeText>
  </NotePlanWorkspace>);
  fireEvent.click(screen.getByRole('button', { name: 'plan.fromNote.generatePointWithSubPoints' }));
  expect(screen.getByRole('button', { name: 'plan.fromNote.generating' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByRole('button', { name: 'plan.pointResultCheck' })).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  resolve({ contentByNodeId: { p: '- Written', sub: '- Child' }, missingMaterial: {} });
  await waitFor(() => expect(empty.applyProposal).toHaveBeenCalledWith({ p: '- Written', sub: '- Child' },
    { p: '', sub: '' }, expect.any(Function)));
  expect(screen.queryByRole('button', { name: 'plan.fromNote.apply' })).not.toBeInTheDocument();
  expect(screen.queryByText('plan.fromNote.current')).not.toBeInTheDocument();
});

it('keeps the existing editor free of source controls when the mode is manual', () => {
  view(false);
  expect(screen.queryByRole('button', { name: 'plan.fromNote.generatePointWithSubPoints' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Study source' })).not.toBeInTheDocument();
});

const REASON_MESSAGE: Record<string, string> = {
  usage: 'plan.fromNote.usageBlocked',
  missing: 'plan.fromNote.sourceUnavailable', loading: 'common.loading',
};

it.each(['usage', 'missing', 'loading'])('explains %s and disables generation', (reason) => {
  mockOnline = true; mockBlocked = reason === 'usage'; mockLoading = reason === 'loading'; mockMissing = reason === 'missing' ? ['gone'] : [];
  view();
  // Held back — and it SAYS so: the block is silent only while generation is actually possible.
  expect(screen.getByText(REASON_MESSAGE[reason])).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'plan.refine.open' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.open' }));
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.presets.rewrite' }));
  expect(screen.getByRole('button', { name: 'plan.refine.submit' })).toBeDisabled();
});

it('keeps generation available when the connection icon says there is none — pressing it makes the request', () => {
  // Owner's decision 2026-10-10: AI actions are not disabled by the icon; a failed request says so.
  mockOnline = false; mockBlocked = false; mockLoading = false; mockMissing = [];
  view();
  expect(screen.queryByText('connection.offlineBanner')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.open' }));
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.presets.rewrite' }));
  expect(screen.getByRole('button', { name: 'plan.refine.submit' })).toBeEnabled();
});

it('shows request errors and allows dismissing a proposed replacement', async () => {
  jest.mocked(generateNotePlanContent).mockRejectedValueOnce(new Error('sourceTooLarge'));
  view();
  requestRefinement();
  await screen.findByText('plan.fromNote.sourceTooLarge');
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
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
  render(<NotePlanWorkspace enabled sermon={{ ...sermon, outline: { introduction: [point], main: [next], conclusion: [] } }} conspectus={{ ...conspectus, contentByNodeId: {} }}>
    <h3 data-testid="first-heading"><NotePointGenerateButton point={point} section="introduction" /></h3>
    <h3 data-testid="next-heading"><NotePointGenerateButton point={next} section="main" /></h3>
  </NotePlanWorkspace>);
  const [first, second] = screen.getAllByRole('button', { name: /plan.fromNote.generatePoint/ });
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

it('reviews a targeted proposal inside its child and applies only that child', async () => {
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { sub: '- Selected child' }, missingMaterial: {} });
  // The child already has words, so its new version is reviewed beside them.
  const written = { ...conspectus, contentByNodeId: { p: 'Original words', sub: 'Child words' } } as unknown as ManualConspectus;
  render(<NotePlanWorkspace enabled sermon={sermon} conspectus={written}>
    <div data-testid="parent-actions"><NotePointGenerateButton point={point} section="main" /><NotePointActions point={point} />
      <NoteNodeText point={point} nodeId="p"><p>Original words</p></NoteNodeText></div>
    <div data-testid="child-actions"><NotePointGenerateButton point={point} section="main" targetNodeId="sub" /><NotePointActions point={point} targetNodeId="sub" />
      <NoteNodeText point={point} nodeId="sub"><p>Child words</p></NoteNodeText></div>
  </NotePlanWorkspace>);
  fireEvent.click(within(screen.getByTestId('child-actions')).getByRole('button', { name: 'plan.refine.open' }));
  fireEvent.click(within(screen.getByTestId('child-actions')).getByRole('button', { name: 'plan.refine.presets.rewrite' }));
  fireEvent.click(within(screen.getByTestId('child-actions')).getByRole('button', { name: 'plan.refine.submit' }));
  expect(await within(screen.getByTestId('child-actions')).findByText('- Selected child')).toBeVisible();
  expect(within(screen.getByTestId('parent-actions')).queryByText('plan.fromNote.suggested')).not.toBeInTheDocument();
  expect(generateNotePlanContent).toHaveBeenCalledWith(expect.objectContaining({ targetNodeId: 'sub' }), undefined, expect.objectContaining({ operationId: expect.any(String) }));
  fireEvent.click(within(screen.getByTestId('child-actions')).getByRole('button', { name: 'plan.fromNote.apply' }));
  expect(conspectus.applyProposal).toHaveBeenCalledWith({ sub: '- Selected child' }, { sub: 'Child words' }, expect.any(Function));
});

it('moves a version whose every written cell was removed to its own card, where it can still be read and dismissed', async () => {
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { p: '', sub: '- Only the child' }, missingMaterial: {} });
  const written = { ...conspectus, contentByNodeId: { p: 'Original words', sub: 'Child words' } } as unknown as ManualConspectus;
  const cells = (current: Sermon, shown: typeof point) => <NotePlanWorkspace enabled sermon={current} conspectus={written}>
    <h3><NotePointGenerateButton point={shown} section="main" /></h3><NotePointActions point={shown} />
    <div data-testid="cell-p"><NoteNodeText point={shown} nodeId="p"><p>Original words</p></NoteNodeText></div>
  </NotePlanWorkspace>;
  const screenView = render(cells(sermon, point));
  fireEvent.click(screen.getAllByRole('button', { name: 'plan.refine.open' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.presets.rewrite' }));
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
  await waitFor(() => expect(generateNotePlanContent).toHaveBeenCalled());
  // The sub-point is deleted; the point stays. Nothing of the version can stand beside a cell any more.
  const withoutChild = { ...point, subPoints: [] };
  screenView.rerender(cells({ ...sermon, outline: { introduction: [], main: [withoutChild], conclusion: [] } } as Sermon, withoutChild));
  expect(await screen.findByText('- Only the child')).toBeInTheDocument();
  expect(screen.getByText('plan.fromNote.detachedProposal')).toBeInTheDocument();
  expect(within(screen.getByTestId('cell-p')).queryByText('plan.fromNote.suggested')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
  await waitFor(() => expect(screen.queryByText('- Only the child')).not.toBeInTheDocument());
});

it('keeps the part written for a removed sub-point readable under the surviving cell', async () => {
  jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { p: '- For the point', sub: '- For the child' }, missingMaterial: {} });
  const written = { ...conspectus, contentByNodeId: { p: 'Original words', sub: 'Child words' } } as unknown as ManualConspectus;
  const cells = (current: Sermon, shown: typeof point) => <NotePlanWorkspace enabled sermon={current} conspectus={written}>
    <h3><NotePointGenerateButton point={shown} section="main" /></h3><NotePointActions point={shown} />
    <div data-testid="cell-p"><NoteNodeText point={shown} nodeId="p"><p>Original words</p></NoteNodeText></div>
  </NotePlanWorkspace>;
  const screenView = render(cells(sermon, point));
  fireEvent.click(screen.getAllByRole('button', { name: 'plan.refine.open' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.presets.rewrite' }));
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
  await screen.findByText('- For the point');
  const withoutChild = { ...point, subPoints: [] };
  screenView.rerender(cells({ ...sermon, outline: { introduction: [], main: [withoutChild], conclusion: [] } } as Sermon, withoutChild));
  const cell = screen.getByTestId('cell-p');
  expect(within(cell).getByText('- For the point')).toBeInTheDocument();
  expect(within(cell).getByText('- For the child')).toBeInTheDocument();
  expect(within(cell).getByText('Their work')).toBeInTheDocument();
  expect(within(cell).getByRole('button', { name: 'common.cancel' })).toBeInTheDocument();
});

it('keeps saying "Generating…" on a removed point\'s own card while its waiting request is checked', async () => {
  jest.mocked(generateNotePlanContent).mockReturnValue(new Promise(() => undefined));
  beginProposal({ owner: 'u', sermonId: 's' }, {
    request: { outlinePointId: 'gone', style: 'memory', expectedContext: 'x' }, before: { gone: '' }, labels: { gone: 'Removed point' },
  });
  render(<NotePlanWorkspace enabled sermon={sermon} conspectus={conspectus}><span /></NotePlanWorkspace>);
  expect(await screen.findByText('plan.fromNote.generating')).toBeInTheDocument();
  expect(screen.getByText('plan.fromNote.detachedProposal')).toBeInTheDocument();
  expect(generateNotePlanContent).toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({ recoverOnly: true }));
});

it('disables the parent while allowing another sibling button during child generation', () => {
  const parent = { ...point, subPoints: [...point.subPoints, { id: 'sibling', text: 'Other child', position: 1 }] };
  jest.mocked(generateNotePlanContent).mockReturnValue(new Promise(() => undefined));
  render(<NotePlanWorkspace enabled sermon={{ ...sermon, outline: { introduction: [], main: [parent], conclusion: [] } }} conspectus={conspectus}>
    <NotePointGenerateButton point={parent} section="main" />
    <NotePointGenerateButton point={parent} section="main" targetNodeId="sub" />
    <NotePointGenerateButton point={parent} section="main" targetNodeId="sibling" />
  </NotePlanWorkspace>);
  const [first, second] = screen.getAllByRole('button', { name: 'plan.fromNote.generateSubPoint' });
  fireEvent.click(first);
  expect(first).toBeDisabled();
  expect(first).toHaveAttribute('aria-busy', 'true');
  expect(second).toBeEnabled();
  expect(screen.getByRole('button', { name: 'plan.refine.open' })).toBeDisabled();
});

it('opens refinement for existing text without contacting AI and restores focus on close', () => {
  view();
  const opener = screen.getByRole('button', { name: 'plan.refine.open' });
  expect(opener).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(opener);
  expect(opener).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById(opener.getAttribute('aria-controls')!)).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'plan.refine.title' })).toHaveFocus();
  expect(generateNotePlanContent).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(opener).toHaveFocus();
  expect(opener).toHaveAttribute('aria-expanded', 'false');
});
