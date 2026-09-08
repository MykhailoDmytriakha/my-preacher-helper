import { fireEvent, render, screen } from '@testing-library/react';

import Switch from '@/components/ui/Switch';

it('exposes its accessible name, state and native click without submitting its parent form', () => {
  const clicked = jest.fn();
  const submitted = jest.fn();
  render(<form onSubmit={submitted}><Switch checked aria-label="Feature" onClick={clicked} /></form>);
  const toggle = screen.getByRole('switch', { name: 'Feature' });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(clicked).toHaveBeenCalledTimes(1);
  expect(submitted).not.toHaveBeenCalled();
});

it('reflects controlled state and respects disabled, class and description props', () => {
  const clicked = jest.fn();
  const { rerender } = render(<Switch checked={false} aria-label="Feature" onClick={clicked} />);
  expect(screen.getByRole('switch')).not.toBeChecked();
  rerender(<><p id="detail">Feature detail</p><Switch checked disabled className="custom" aria-describedby="detail" onClick={clicked} /></>);
  expect(screen.getByRole('switch')).toBeChecked();
  expect(screen.getByRole('switch')).toHaveAccessibleDescription('Feature detail');
  expect(screen.getByRole('switch')).toHaveClass('custom');
  fireEvent.click(screen.getByRole('switch'));
  expect(clicked).not.toHaveBeenCalled();
});
