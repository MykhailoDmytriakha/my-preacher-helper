import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

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

it('keeps confirmed plan deletion visibly pending until the local write is accepted', async () => {
  const tree: ExegeticalPlanNode[] = [
    { id: 'parent', title: 'Authored parent', children: [{ id: 'child', title: 'Authored child' }] },
    { id: 'neighbor', title: 'Unrelated point' },
  ];
  let accept!: () => void;
  const localWrite = new Promise<void>(resolve => { accept = resolve; });
  function Page() {
    const [value, setValue] = useState(tree);
    // The editor publishes its optimistic draft while the local transaction is still pending.
    const edit = (updater: (nodes: ExegeticalPlanNode[]) => ExegeticalPlanNode[]) => {
      setValue(updater);
      return localWrite;
    };
    const props = { subject: 'owner:sermon', value, onEdit: edit, onCommitRemoval: edit };
    return <ExegeticalPlanModule {...props} />;
  }

  render(<Page />);
  fireEvent.click(screen.getAllByRole('button', { name: 'wizard.steps.exegeticalPlan.builder.tooltips.delete' })[0]);
  const confirm = await screen.findByRole('button', { name: 'common.delete' });
  await act(async () => { fireEvent.click(confirm); });

  expect(screen.getByRole('dialog', { name: 'common.deleteItem.title' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'common.deleting' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();

  await act(async () => { accept(); });
  expect(screen.queryByRole('dialog', { name: 'common.deleteItem.title' })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Authored parent')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Authored child')).not.toBeInTheDocument();
  expect(screen.getByDisplayValue('Unrelated point')).toBeInTheDocument();
});

it('retries the same failed removal without applying the deletion a second time', async () => {
  const nodes: ExegeticalPlanNode[] = [
    { id: 'parent', title: 'Authored parent' },
    { id: 'neighbor', title: 'Unrelated point' },
  ];
  const commit = jest.fn();
  const retry = jest.fn(async () => undefined);
  function Page() {
    const [value, setValue] = useState(nodes);
    commit.mockImplementation(async (edit: (current: ExegeticalPlanNode[]) => ExegeticalPlanNode[]) => {
      setValue(edit);
      throw new Error('Local write failed');
    });
    return <ExegeticalPlanModule subject="owner:sermon" value={value} onEdit={jest.fn()}
      onCommitRemoval={commit} onRetryRemoval={retry} />;
  }

  render(<Page />);
  fireEvent.click(screen.getAllByRole('button', { name: 'wizard.steps.exegeticalPlan.builder.tooltips.delete' })[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('dataSync.phase.localFailure');
  expect(screen.getByRole('button', { name: 'common.close' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'common.deleteItem.title' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.retry' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'common.deleteItem.title' })).not.toBeInTheDocument());
  expect(commit).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByDisplayValue('Unrelated point')).toBeInTheDocument();
});

it('does not cut a subtree changed in the editor before its latest updater runs', async () => {
  const nodes: ExegeticalPlanNode[] = [{ id: 'parent', title: 'Authored parent' }];
  const latest: ExegeticalPlanNode[] = [{ ...nodes[0], children: [{ id: 'child', title: 'New child' }] }];
  const commit = jest.fn(async (edit: (current: ExegeticalPlanNode[]) => ExegeticalPlanNode[]) => {
    edit(latest);
  });
  render(<ExegeticalPlanModule subject="owner:sermon" value={nodes} onEdit={jest.fn()} onCommitRemoval={commit} />);

  fireEvent.click(screen.getByRole('button', { name: 'wizard.steps.exegeticalPlan.builder.tooltips.delete' }));
  fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'common.deleteItem.title' })).not.toBeInTheDocument());
  expect(commit).toHaveBeenCalledTimes(1);
  expect(screen.getByDisplayValue('Authored parent')).toBeInTheDocument();
});

it('allows leaving the failed deletion dialog to resolve a version choice', async () => {
  const nodes: ExegeticalPlanNode[] = [{ id: 'parent', title: 'Authored parent' }];
  const commit = jest.fn(async (edit: (current: ExegeticalPlanNode[]) => ExegeticalPlanNode[]) => {
    edit(nodes);
    throw Object.assign(new Error('Resolve before saving'), { code: 'resolve-version-first' });
  });
  render(<ExegeticalPlanModule value={nodes} onEdit={jest.fn()} onCommitRemoval={commit} />);

  fireEvent.click(screen.getByRole('button', { name: 'wizard.steps.exegeticalPlan.builder.tooltips.delete' }));
  fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('dataSync.failure.resolveVersionFirst');
  expect(screen.getByRole('button', { name: 'dataSync.retry' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  expect(screen.queryByRole('dialog', { name: 'common.deleteItem.title' })).not.toBeInTheDocument();
});
