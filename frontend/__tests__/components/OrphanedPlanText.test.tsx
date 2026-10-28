import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { OrphanedPlanText, orphanedCells, mergeOrphans } from '@/(pages)/(private)/sermons/[id]/plan/OrphanedPlanText';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const mockCopy = jest.fn();
jest.mock('@/hooks/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: mockCopy }) }));

describe('text whose card was removed elsewhere', () => {
  it('keeps only unsaved, non-empty cells whose node the outline lost', () => {
    const cells = orphanedCells(
      { gone: 'Paragraph typed here', kept: 'Still in the plan', empty: '  ', saved: 'Already saved' },
      { gone: true, kept: true, empty: true, saved: false },
      new Set(['kept'])
    );
    expect(cells).toEqual([{ id: 'gone', text: 'Paragraph typed here' }]);
  });

  it('shows the words in full with copy and let-go', async () => {
    const onDiscard = jest.fn();
    render(<OrphanedPlanText cells={[{ id: 'gone', text: 'Paragraph typed here' }]} onDiscard={onDiscard} />);
    expect(screen.getByText('Paragraph typed here')).toBeInTheDocument();
    fireEvent.click(screen.getByText('plan.orphanedCopy'));
    expect(mockCopy).toHaveBeenCalledWith('Paragraph typed here');
    fireEvent.click(screen.getByText('plan.orphanedDiscard'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.discardText.confirm' }));
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith([{ id: 'gone', text: 'Paragraph typed here' }]));
    expect(onDiscard).toHaveBeenCalledWith([{ id: 'gone', text: 'Paragraph typed here' }]);
  });

  it('says nothing when no text is orphaned', () => {
    const { container } = render(<OrphanedPlanText cells={[]} onDiscard={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});


it('keeps the only orphaned words until their removal is confirmed', async () => {
  const discard = jest.fn();
  render(<OrphanedPlanText cells={[{ id: 'gone', text: 'Only remaining authored paragraph' }]} onDiscard={discard} />);
  fireEvent.click(screen.getByText('plan.orphanedDiscard'));
  expect(discard).not.toHaveBeenCalled();
  expect(await screen.findByRole('dialog', { name: 'common.discardText.title' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'common.discardText.keep' }));
  expect(discard).not.toHaveBeenCalled();
  expect(screen.getByText('Only remaining authored paragraph')).toBeInTheDocument();

  fireEvent.click(screen.getByText('plan.orphanedDiscard'));
  fireEvent.click(await screen.findByRole('button', { name: 'common.discardText.confirm' }));
  await waitFor(() => expect(discard).toHaveBeenCalledWith([{ id: 'gone', text: 'Only remaining authored paragraph' }]));
  expect(discard).toHaveBeenCalledTimes(1);
});


it('does not discard replacement orphan words or another document after an old question', async () => {
  const discard = jest.fn();
  const view = render(<OrphanedPlanText subject="sermon-a" cells={[{ id: 'gone', text: 'Shown old words' }]} onDiscard={discard} />);
  fireEvent.click(screen.getByText('plan.orphanedDiscard'));
  await screen.findByRole('dialog', { name: 'common.discardText.title' });
  view.rerender(<OrphanedPlanText subject="sermon-b" cells={[{ id: 'gone', text: 'New unseen words' }]} onDiscard={discard} />);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(discard).not.toHaveBeenCalled();
  expect(screen.getByText('New unseen words')).toBeInTheDocument();
});

it('withdraws a question when its orphan disappears instead of reviving it later', async () => {
  const discard = jest.fn();
  const cells = [{ id: 'gone', text: 'Shown orphan words' }];
  const view = render(<OrphanedPlanText subject="sermon" cells={cells} onDiscard={discard} />);
  fireEvent.click(screen.getByText('plan.orphanedDiscard'));
  await screen.findByRole('dialog', { name: 'common.discardText.title' });
  view.rerender(<OrphanedPlanText subject="sermon" cells={[]} onDiscard={discard} />);
  view.rerender(<OrphanedPlanText subject="sermon" cells={cells} onDiscard={discard} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(discard).not.toHaveBeenCalled();
});


it('keeps different and equal stored copies beside the current text of one removed point', () => {
  const current = [{ id: 'gone', text: 'Current words' }];
  const stored = [{ id: 'gone', text: 'Other words', copyKey: 'first' }, { id: 'gone', text: 'Current words', copyKey: 'second' }];
  expect(mergeOrphans(current, stored)).toEqual([...current, ...stored]);
});

it('discards the selected orphan copy without addressing another version of the same point', async () => {
  const discard = jest.fn();
  const cells = [{ id: 'gone', text: 'First version', copyKey: 'first' }, { id: 'gone', text: 'Second version', copyKey: 'second' }];
  render(<OrphanedPlanText cells={cells} onDiscard={discard} />);
  fireEvent.click(within(screen.getByText('Second version').closest('li')!).getByRole('button', { name: 'plan.orphanedDiscard' }));
  fireEvent.click(await screen.findByRole('button', { name: 'common.discardText.confirm' }));
  await waitFor(() => expect(discard).toHaveBeenCalledWith([cells[1]]));
  expect(screen.getByText('First version')).toBeVisible();
});
