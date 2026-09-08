import { act, fireEvent, render, screen } from '@testing-library/react';

import { ThoughtOptionsMenu } from '@/components/ThoughtOptionsMenu';

it('does not close a reopened menu when a previous copy finishes after dismissal', async () => {
  let finish!: () => void;
  const writeText = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  render(<ThoughtOptionsMenu thoughtText="Original text" onEdit={jest.fn()} onDelete={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'thought.optionsMenuLabel' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'common.copy' }));
  fireEvent.mouseDown(document.body);
  fireEvent.click(screen.getByRole('button', { name: 'thought.optionsMenuLabel' }));
  await act(async () => { finish(); });
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'common.copy' })).toBeEnabled();
  expect(writeText).toHaveBeenCalledWith('Original text');
});
