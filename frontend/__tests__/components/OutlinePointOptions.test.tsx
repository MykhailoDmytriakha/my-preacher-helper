import { fireEvent, render, screen } from '@testing-library/react';

import { OutlinePointOptions } from '@/components/thought/OutlinePointOptions';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const groups = { introduction: [], main: [{ id: 'point', text: 'Point', subPoints: [{ id: 'later', text: 'Later', position: 2000 }, { id: 'first', text: 'First', position: 1000 }] }], conclusion: [] };

it('renders ordered subpoints and sends exact selection pairs without submitting an enclosing form', () => {
  const select = jest.fn();
  const submit = jest.fn(event => event.preventDefault());
  render(<form onSubmit={submit}><OutlinePointOptions groups={groups} outlinePointId="point" subPointId="first" onSelect={select} /></form>);
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['editThought.noSermonPoint', 'Point', 'First', 'Later']);
  for (const name of ['Point', 'First', 'editThought.noSermonPoint']) fireEvent.click(screen.getByRole('button', { name }));
  expect(select.mock.calls).toEqual([['point', null], ['point', 'first'], [null, null]]);
  expect(submit).not.toHaveBeenCalled();
  expect(groups.main[0].subPoints.map(point => point.id)).toEqual(['later', 'first']);
});

it('hides optional clearing and locks every choice while its owner saves', () => {
  const select = jest.fn();
  render(<OutlinePointOptions groups={groups} onSelect={select} disabled allowClear={false} />);
  expect(screen.queryByText('editThought.noSermonPoint')).toBeNull();
  screen.getAllByRole('button').forEach(button => { expect(button).toBeDisabled(); fireEvent.click(button); });
  expect(select).not.toHaveBeenCalled();
});
