import { fireEvent, render, screen } from '@testing-library/react';

import { ThoughtOutlineField } from '@/components/thought/ThoughtOutlineField';

import type { SermonOutline } from '@/models/models';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const outline: SermonOutline = { introduction: [{ id: 'intro', text: 'Intro', subPoints: [{ id: 'sub', text: 'Sub', position: 0 }] }], main: [{ id: 'main', text: 'Main' }], conclusion: [] };

it('names the control, filters its section and selects a subpoint or clears the location', () => {
  const select = jest.fn();
  render(<ThoughtOutlineField sermonOutline={outline} section="introduction" outlinePointId="intro" subPointId="sub" onSelect={select} />);
  const trigger = screen.getByRole('button', { name: 'editThought.outlinePointLabel' });
  expect(trigger).toHaveTextContent('Intro / Sub');
  fireEvent.click(trigger);
  expect(screen.queryByRole('button', { name: 'Main' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sub' }));
  expect(select).toHaveBeenCalledWith('intro', 'sub');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'editThought.noSermonPoint' }));
  expect(select).toHaveBeenLastCalledWith(null, null);
});

it('shows all sections without a restriction and dismisses only an outside press', () => {
  render(<ThoughtOutlineField sermonOutline={outline} onSelect={jest.fn()} />);
  const trigger = screen.getByRole('button', { name: 'editThought.outlinePointLabel' });
  fireEvent.click(trigger);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Main' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.mouseDown(document.body);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('keeps disabled controls inert and tolerates unavailable legacy outline arrays', () => {
  const props = { onSelect: jest.fn(), sermonOutline: { introduction: undefined, main: undefined, conclusion: undefined } as unknown as SermonOutline };
  const { rerender } = render(<ThoughtOutlineField {...props} disabled />);
  const trigger = screen.getByRole('button', { name: 'editThought.outlinePointLabel' });
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  rerender(<ThoughtOutlineField {...props} section="main" />);
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: 'editThought.noSermonPoint' })).toBeEnabled();
  rerender(<ThoughtOutlineField onSelect={props.onSelect} />);
  expect(screen.queryByRole('button', { name: 'Main' })).toBeNull();
  expect(props.onSelect).not.toHaveBeenCalled();
});
