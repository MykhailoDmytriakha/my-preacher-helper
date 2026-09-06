import { fireEvent, render, screen } from '@testing-library/react';

import NotePlanRefinement from '@/(pages)/(private)/sermons/[id]/plan/manual/NotePlanRefinement';

const defaults = { id: 'sub', open: true, scope: 'Only this detail', busy: false, disabled: false, onClose: jest.fn(), onGenerate: jest.fn() };
beforeEach(() => jest.clearAllMocks());

it('focuses the inline composer, states the scope, and requires a nonempty instruction', () => {
  render(<NotePlanRefinement {...defaults} />);
  const input = screen.getByRole('textbox', { name: 'plan.refine.title' });
  expect(input).toHaveFocus();
  expect(screen.getByText('Only this detail')).toBeVisible();
  expect(screen.getByRole('button', { name: 'plan.refine.submit' })).toBeDisabled();
  fireEvent.change(input, { target: { value: '  Keep the opening, shorten the last cue.  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
  expect(defaults.onGenerate).toHaveBeenCalledWith({ instruction: 'Keep the opening, shorten the last cue.', mode: 'edit' });
});

it.each([['references', 'references'], ['more', 'edit'], ['shorter', 'edit'], ['rewrite', 'rewrite']])('fills an editable %s request', (preset, mode) => {
  render(<NotePlanRefinement {...defaults} />);
  fireEvent.click(screen.getByRole('button', { name: `plan.refine.presets.${preset}` }));
  expect(screen.getByRole('textbox')).toHaveValue(`plan.refine.requests.${preset}`);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Custom refinement' } });
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
  expect(defaults.onGenerate).toHaveBeenCalledWith({ instruction: 'Custom refinement', mode });
});

it('can leave references-only mode and use a free instruction', () => {
  render(<NotePlanRefinement {...defaults} />);
  const preset = screen.getByRole('button', { name: 'plan.refine.presets.references' });
  fireEvent.click(preset);
  expect(screen.getByText('plan.refine.referencesHint')).toBeVisible();
  fireEvent.click(preset);
  expect(preset).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
  expect(defaults.onGenerate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'edit' }));
});

it('keeps the draft when closed and reopened, supports shortcut submission and Escape', () => {
  const { rerender } = render(<NotePlanRefinement {...defaults} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My request' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(defaults.onGenerate).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
  expect(defaults.onGenerate).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(defaults.onClose).toHaveBeenCalledTimes(1);
  rerender(<NotePlanRefinement {...defaults} open={false} />);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  rerender(<NotePlanRefinement {...defaults} />);
  expect(screen.getByRole('textbox')).toHaveValue('My request');
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  expect(defaults.onClose).toHaveBeenCalledTimes(2);
});

it.each([{ busy: true, disabled: false }, { busy: false, disabled: true }])('prevents submission when unavailable: %j', (flags) => {
  render(<NotePlanRefinement {...defaults} {...flags} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Request' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true });
  expect(defaults.onGenerate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: flags.busy ? 'plan.refine.working' : 'plan.refine.submit' })).toBeDisabled();
});
