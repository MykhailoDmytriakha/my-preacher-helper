import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { PreparationPlanList } from '@/components/sermon/prep/PreparationPlanList';

import type { PreparationPlanBinding } from '@/components/sermon/prep/PreparationPlanList';
import type { PreparationPlanItem } from '@/utils/preparationFieldValues';

jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

type Kind = 'updatedPlan' | 'sermonPlan';
function delayedPlan(kind: Kind, initial: PreparationPlanItem[] = [{ id: 'one', title: 'A' }]) {
  const pending: Array<{ apply(): void; reject(error: Error): void }> = [];
  let binding: PreparationPlanBinding = {
    subject: 'sermon-one-plan', value: initial, ready: true, active: true, busy: false, dirty: false, error: null,
    begin: async () => undefined, update: async () => undefined, save: async () => undefined,
    cancel: async () => undefined, retry: async () => undefined,
    recovery: { choices: [], loading: false, error: null, recover: async () => undefined,
      refresh: async () => undefined, discard: async action => action() },
    edit: jest.fn(updater => new Promise<void>((resolve, reject) => {
      pending.push({ apply: () => { binding = { ...binding, value: updater(binding.value) }; resolve(); }, reject });
    })),
  };
  const view = render(<PreparationPlanList binding={binding} kind={kind} />);
  const show = (value: PreparationPlanItem[], subject = binding.subject) => {
    binding = { ...binding, value, subject };
    view.rerender(<PreparationPlanList binding={binding} kind={kind} />);
  };
  return {
    show, binding: () => binding,
    echo: async () => { await act(async () => { pending.shift()!.apply(); }); show(binding.value); },
    refuse: async () => { await act(async () => { pending.shift()!.reject(new Error('Local stage refused')); }); },
  };
}
function append(input: HTMLInputElement, letters: string) {
  for (const letter of letters) fireEvent.change(input, { target: { value: input.value + letter } });
}

describe.each<Kind>(['updatedPlan', 'sermonPlan'])('%s delayed title echoes', kind => {
  it('keeps every typed letter before the document has echoed any change', async () => {
    const plan = delayedPlan(kind);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    append(input, 'BCD');
    expect(input).toHaveValue('ABCD');
    await plan.echo();
    expect(input).toHaveValue('ABCD');
    await plan.echo();
    expect(input).toHaveValue('ABCD');
    await plan.echo();
    expect(input).toHaveValue('ABCD');
    expect(plan.binding().value).toEqual([{ id: 'one', title: 'ABCD' }]);
  });

  it('follows the document again after its own title is acknowledged', async () => {
    const plan = delayedPlan(kind);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Mine' } });
    await plan.echo();
    plan.show([{ id: 'one', title: 'Continued on the phone' }]);
    expect(input).toHaveValue('Continued on the phone');
  });

  it('follows an untouched title without writing it back', () => {
    const plan = delayedPlan(kind);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    plan.show([{ id: 'one', title: 'New stored title' }]);
    expect(input).toHaveValue('New stored title');
    expect(plan.binding().edit).not.toHaveBeenCalled();
  });

  it('keeps refused words visible but allows the next document value', async () => {
    const plan = delayedPlan(kind);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Unsaved words' } });
    await plan.refuse();
    expect(input).toHaveValue('Unsaved words');
    plan.show([{ id: 'one', title: 'Next document' }]);
    expect(input).toHaveValue('Next document');
  });

  it('keeps a pending title with its point when the list is reordered', async () => {
    const plan = delayedPlan(kind, [{ id: 'one', title: 'A' }, { id: 'two', title: 'B' }]);
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'My first point' } });
    plan.show([{ id: 'two', title: 'B' }, { id: 'one', title: 'A' }]);
    expect(screen.getAllByRole('textbox')[1]).toBe(input);
    expect(input).toHaveValue('My first point');
    await plan.echo();
    expect(plan.binding().value).toEqual([{ id: 'two', title: 'B' }, { id: 'one', title: 'My first point' }]);
  });

  it('does not carry an unacknowledged title into another sermon with the same point id', () => {
    const plan = delayedPlan(kind);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First sermon draft' } });
    plan.show([{ id: 'one', title: 'Second sermon title' }], 'sermon-two-plan');
    expect(screen.getByRole('textbox')).toHaveValue('Second sermon title');
  });
});
