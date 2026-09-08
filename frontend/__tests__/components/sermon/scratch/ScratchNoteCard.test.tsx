import { fireEvent, render, screen } from '@testing-library/react';

import ScratchNoteCard from '@/components/sermon/scratch/ScratchNoteCard';

import type { ScratchPlaceTarget } from '@/components/sermon/scratch/ScratchNoteCard';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const note = { id: 'note', text: 'Exact note text', createdAt: '2026-09-07' };
const targets: ScratchPlaceTarget[] = [
  { key: 'pool', label: 'Pool', depth: 0, target: null },
  { key: 'point:a', label: 'Point A', depth: 0, target: { pointId: 'a' } },
  { key: 'sub:b', label: 'Sub B', depth: 1, target: { pointId: 'a', subPointId: 'b' } },
  { key: 'point:c', label: 'Point C', depth: 0, target: { pointId: 'c' } },
];

it('preserves editor focus and draft through rerender, commits on Enter, and routes empty text to deletion', () => {
  const props = { note, onEdit: jest.fn(), onDelete: jest.fn() };
  const { rerender } = render(<ScratchNoteCard {...props} />);
  fireEvent.click(screen.getByText(note.text));
  const editor = screen.getByRole('textbox');
  fireEvent.change(editor, { target: { value: 'My unfinished text' } });
  rerender(<ScratchNoteCard {...props} note={{ ...note, text: 'Background update' }} />);
  expect(screen.getByRole('textbox')).toBe(editor);
  expect(editor).toHaveFocus();
  expect(editor).toHaveValue('My unfinished text');
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(props.onEdit).toHaveBeenCalledWith('note', 'My unfinished text');
  fireEvent.click(screen.getByText('Background update'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: ' ' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(props.onDelete).toHaveBeenCalledWith('note');
});

it('omits the current target and supports keyboard navigation, dismissal and exact placement', () => {
  const place = jest.fn();
  render(<ScratchNoteCard note={note} onEdit={jest.fn()} onDelete={jest.fn()} placeTargets={targets} currentTargetKey="pool" onPlaceInto={place} />);
  const trigger = screen.getByRole('button', { name: 'scratch.card.placeInto' });
  fireEvent.click(trigger);
  const menu = screen.getByRole('menu');
  const items = screen.getAllByRole('menuitem');
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'Shift' });
  expect(items[0]).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'ArrowUp' });
  expect(items[2]).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(items[0]).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'End' });
  expect(items[2]).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'Home' });
  expect(items[0]).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(place).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: '↳ Sub B' }));
  expect(place).toHaveBeenCalledWith('note', { pointId: 'a', subPointId: 'b' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('exposes explicit unplace/delete actions and makes read-only and drag-preview cards noninteractive', () => {
  const props = { note, onEdit: jest.fn(), onDelete: jest.fn(), onUnplace: jest.fn() };
  const { rerender } = render(<ScratchNoteCard {...props} dragHandleProps={{}} />);
  expect(screen.getByRole('button', { name: 'common.dragToReorder' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'scratch.board.unplace' }));
  expect(props.onUnplace).toHaveBeenCalledWith('note');
  fireEvent.click(screen.getByRole('button', { name: 'scratch.card.delete' }));
  expect(props.onDelete).toHaveBeenCalledTimes(1);
  rerender(<ScratchNoteCard {...props} isReadOnly />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(note.text));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  rerender(<ScratchNoteCard {...props} isOverlay />);
  expect(screen.getByTestId('scratch-note-overlay-note')).toHaveTextContent(note.text);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
