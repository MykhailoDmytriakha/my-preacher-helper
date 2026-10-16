import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ExegeticalPlanModule from '@/components/sermon/prep/exegeticalPlan/ExegeticalPlanModule';

import type { ExegeticalPlanNode } from '@/models/models';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('keeps a written plan point and its children until deletion is confirmed', async () => {
  const tree: ExegeticalPlanNode[] = [
    { id: 'parent', title: 'Authored parent', children: [{ id: 'child', title: 'Authored child', children: [] }] },
    { id: 'neighbor', title: 'Unrelated point', children: [] },
  ];
  const edit = jest.fn();
  render(<ExegeticalPlanModule value={tree} onEdit={edit} saving={false} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'wizard.steps.exegeticalPlan.builder.tooltips.delete' })[0]);
  expect(edit).not.toHaveBeenCalled();
  expect(await screen.findByRole('dialog', { name: 'common.deleteItem.title' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
  expect(edit).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('Authored parent')).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: 'wizard.steps.exegeticalPlan.builder.tooltips.delete' })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }));
  await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
  const newer = [...tree, { id: 'new-neighbor', title: 'Added elsewhere', children: [] }];
  expect(edit.mock.calls[0][0](newer)).toEqual(newer.slice(1));
});

it.each(['owner-b:sermon-a', 'owner-a:sermon-b'])('withdraws a deletion question when its subject becomes %s with identical nodes', async (subject) => {
  const tree: ExegeticalPlanNode[] = [{ id: 'same-point', title: 'Identical authored words', children: [] }];
  const oldEdit = jest.fn();
  const nextEdit = jest.fn();
  const initial = { subject: 'owner-a:sermon-a', value: tree, onEdit: oldEdit };
  const next = { subject, value: tree, onEdit: nextEdit };
  const view = render(<ExegeticalPlanModule {...initial} />);
  fireEvent.click(screen.getByRole('button', { name: 'wizard.steps.exegeticalPlan.builder.tooltips.delete' }));
  await screen.findByRole('dialog', { name: 'common.deleteItem.title' });
  view.rerender(<ExegeticalPlanModule {...next} />);
  expect(screen.queryByRole('dialog', { name: 'common.deleteItem.title' })).not.toBeInTheDocument();
  expect(oldEdit).not.toHaveBeenCalled();
  expect(nextEdit).not.toHaveBeenCalled();
});
