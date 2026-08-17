import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import SourceNotePickerModal from '@/components/sermon/SourceNotePickerModal';
import { useStudyNoteDirectory } from '@/hooks/useSermonNoteLinks';

import type { StudyNote } from '@/models/models';

/**
 * ONE DIALOG FOR BOTH ADDING AND REMOVING, so what it hands back must be exactly what is left
 * ticked — and it must not close on a write the server refused, or the person would believe a
 * choice was stored that was not.
 */
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      typeof options?.count === 'number' ? `${key}:${options.count}` : key,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/hooks/useSermonNoteLinks', () => ({ useStudyNoteDirectory: jest.fn() }));

const mockDirectory = useStudyNoteDirectory as jest.MockedFunction<typeof useStudyNoteDirectory>;

const aNote = (id: string, title: string, tags: string[] = []): StudyNote =>
  ({
    id,
    title,
    tags,
    userId: 'u1',
    content: '',
    scriptureRefs: [],
    isDraft: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: `2026-08-0${id.slice(-1)}T00:00:00.000Z`,
  }) as StudyNote;

beforeEach(() => {
  jest.clearAllMocks();
  mockDirectory.mockReturnValue({
    notes: [aNote('n1', 'Wine and wineskins', ['typology']), aNote('n2', 'Job and the mediator')],
    loading: false,
    ready: true,
  });
});

it('opens with the already linked note ticked', () => {
  render(
    <SourceNotePickerModal selectedNoteIds={['n1']} onSave={jest.fn()} onClose={jest.fn()} />
  );

  const checkboxes = screen.getAllByRole('checkbox');
  expect(checkboxes[0]).toBeChecked(); // linked notes are sorted to the top
  expect(screen.getByTestId('source-note-selected-count')).toHaveTextContent('1');
});

it('narrows the list as you type, matching tags as well as titles', () => {
  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={jest.fn()} />);

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typology' } });

  expect(screen.getByText('Wine and wineskins')).toBeInTheDocument();
  expect(screen.queryByText('Job and the mediator')).not.toBeInTheDocument();
});

it('saves exactly what is left ticked, then closes', async () => {
  const onSave = jest.fn().mockResolvedValue({ outcome: 'saved' });
  const onClose = jest.fn();
  render(<SourceNotePickerModal selectedNoteIds={['n1']} onSave={onSave} onClose={onClose} />);

  const row = screen.getByText('Job and the mediator').closest('label') as HTMLElement;
  fireEvent.click(row.querySelector('input') as HTMLElement);
  fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

  await waitFor(() => expect(onSave).toHaveBeenCalledWith(['n1', 'n2']));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it('closes on a QUEUED write, because the choice is already durable offline', async () => {
  const onSave = jest.fn().mockResolvedValue({ outcome: 'queued' });
  const onClose = jest.fn();
  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={onSave} onClose={onClose} />);

  const row = screen.getByText('Wine and wineskins').closest('label') as HTMLElement;
  fireEvent.click(row.querySelector('input') as HTMLElement);
  fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  // Staying open with a Cancel button would promise a cancellation that does not exist: the
  // intent is in the outbox and will replay.
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it('stays open on an unknown failure, keeping the selection on screen', async () => {
  const onSave = jest.fn().mockResolvedValue({ outcome: 'failed' });
  const onClose = jest.fn();
  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={onSave} onClose={onClose} />);

  const row = screen.getByText('Wine and wineskins').closest('label') as HTMLElement;
  fireEvent.click(row.querySelector('input') as HTMLElement);
  fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onClose).not.toHaveBeenCalled();
});

it('ADOPTS the server list when the save was refused, so the next press is not doomed', async () => {
  const onSave = jest
    .fn()
    .mockResolvedValue({ outcome: 'stale', serverNoteIds: ['n2'], serverRevision: 9 });
  const onClose = jest.fn();
  render(<SourceNotePickerModal selectedNoteIds={['n1']} onSave={onSave} onClose={onClose} />);

  const row = screen.getByText('Job and the mediator').closest('label') as HTMLElement;
  fireEvent.click(row.querySelector('input') as HTMLElement);
  fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

  await waitFor(() => expect(onSave).toHaveBeenCalledWith(['n1', 'n2']));
  // The dialog stays, now showing what the OTHER device stored — pressing Save again means
  // "mine wins" rather than repeating a refusal against a stale baseline for ever.
  expect(onClose).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByText('Job and the mediator').closest('label')?.querySelector('input')).toBeChecked()
  );
  expect(screen.getByText('Wine and wineskins').closest('label')?.querySelector('input')).not.toBeChecked();
});

it('shows a linked note that was DELETED as its own removable row', async () => {
  const onSave = jest.fn().mockResolvedValue({ outcome: 'saved' });
  render(
    <SourceNotePickerModal selectedNoteIds={['n1', 'deleted-note']} onSave={onSave} onClose={jest.fn()} />
  );

  // Without this row the footer says two while one row shows, and the dead id can only be
  // cleared by unlinking everything.
  const deadRow = screen.getByTestId('missing-note-row');
  expect(deadRow).toHaveTextContent('sermon.sourceNotes.picker.deletedNote');
  expect(screen.getByTestId('source-note-selected-count')).toHaveTextContent('2');

  fireEvent.click(deadRow.querySelector('input') as HTMLElement);
  fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

  await waitFor(() => expect(onSave).toHaveBeenCalledWith(['n1']));
});

it('unlinks everything in one press', () => {
  render(<SourceNotePickerModal selectedNoteIds={['n1', 'n2']} onSave={jest.fn()} onClose={jest.fn()} />);

  fireEvent.click(screen.getByText('sermon.sourceNotes.picker.clear'));

  expect(screen.getByTestId('source-note-selected-count')).toHaveTextContent('0');
  expect(screen.getAllByRole('checkbox').every((box) => !(box as HTMLInputElement).checked)).toBe(true);
});

it('closes on Escape, the exit every other dialog here offers', () => {
  const onClose = jest.fn();
  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={onClose} />);

  fireEvent.keyDown(window, { key: 'Escape' });

  expect(onClose).toHaveBeenCalled();
});

it('says there are no notes yet instead of showing an empty box', () => {
  mockDirectory.mockReturnValue({ notes: [], loading: false, ready: true });

  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={jest.fn()} />);

  expect(screen.getByText('sermon.sourceNotes.picker.empty')).toBeInTheDocument();
});

it('waits with placeholders rather than claiming the person has no notes', () => {
  mockDirectory.mockReturnValue({ notes: [], loading: true, ready: false });

  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={jest.fn()} />);

  expect(screen.queryByText('sermon.sourceNotes.picker.empty')).not.toBeInTheDocument();
  expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
});

it('tells the difference between "you have none" and "this search found none"', () => {
  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={jest.fn()} />);

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'nothing matches this' } });

  expect(screen.getByText('sermon.sourceNotes.picker.noMatches')).toBeInTheDocument();
  expect(screen.queryByText('sermon.sourceNotes.picker.empty')).not.toBeInTheDocument();
});

it('shows the reference on the row, so a note is recognisable without opening it', () => {
  mockDirectory.mockReturnValue({
    notes: [
      {
        ...aNote('n3', 'Water into wine'),
        scriptureRefs: [{ id: 'r1', book: 'John', chapter: 2, fromVerse: 1, toVerse: 11 }],
      } as StudyNote,
    ],
    loading: false,
    ready: true,
  });

  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={jest.fn()} />);

  expect(screen.getByText(/2:1-11/)).toBeInTheDocument();
});

it('is full-screen on a phone and a centred card from sm up — the repo rule about mobile modals', () => {
  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={jest.fn()} />);

  const dialog = screen.getByRole('dialog');
  const classes = dialog.className;
  // The rule exists because a capped-height card with an inner scroller traps touch on a
  // phone. Asserted as a contract on the classes: jsdom cannot evaluate media queries, so
  // this is what stops a mobile height cap being re-added by a later edit.
  expect(classes).toContain('h-full');
  expect(classes).toContain('w-full');
  expect(classes).toContain('sm:max-h-[85vh]');
  expect(classes).not.toMatch(/(^|\s)max-h-/); // no unprefixed height cap
});

it('does NOT call a linked note deleted when the note list could not be read', () => {
  // A failed read returns an empty list. Treating that as "your notes are gone" would invite
  // unlinking notes that exist perfectly well — so the row only appears on a known-good list.
  mockDirectory.mockReturnValue({ notes: [], loading: false, ready: false });

  render(<SourceNotePickerModal selectedNoteIds={['n1']} onSave={jest.fn()} onClose={jest.fn()} />);

  expect(screen.queryByTestId('missing-note-row')).not.toBeInTheDocument();
});

it('writes nothing and just closes when the ticks were never touched', async () => {
  const onSave = jest.fn();
  const onClose = jest.fn();
  render(<SourceNotePickerModal selectedNoteIds={['n1']} onSave={onSave} onClose={onClose} />);

  fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it('cannot be dismissed while a save is in flight', () => {
  const onClose = jest.fn();
  render(
    <SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={onClose} saving />
  );

  // The answer decides whether this dialog closes or keeps the choice on screen; it can do
  // neither once it has been dismissed mid-request.
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText('sermon.sourceNotes.picker.cancel')).toBeDisabled();
});

it('starts with focus in the search field and gives it back to the opener on close', () => {
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  const returnFocusTo = { current: opener };

  const { unmount } = render(
    <SourceNotePickerModal
      selectedNoteIds={[]}
      onSave={jest.fn()}
      onClose={jest.fn()}
      returnFocusTo={returnFocusTo}
    />
  );

  expect(screen.getByRole('textbox')).toHaveFocus();

  unmount();

  // Reading `document.activeElement` at mount cannot work here: the menu holding the opener has
  // already unmounted, so the dialog is handed the element explicitly.
  expect(opener).toHaveFocus();
  opener.remove();
});

it('keeps exactly ONE scroll region inside the dialog', () => {
  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={jest.fn()} />);

  const dialog = screen.getByRole('dialog');
  expect(dialog.querySelectorAll('.overflow-y-auto')).toHaveLength(1);
});

it('freezes the selection while a save is in flight', () => {
  // The writer already holds the list it was given; a tick added now would be dropped the
  // moment a successful answer closes the dialog.
  render(
    <SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={jest.fn()} saving />
  );

  const row = screen.getByText('Wine and wineskins').closest('label') as HTMLElement;
  const checkbox = row.querySelector('input') as HTMLInputElement;
  expect(checkbox).toBeDisabled();

  fireEvent.click(checkbox);
  expect(screen.getByTestId('source-note-selected-count')).toHaveTextContent('0');
});

it('wraps Tab at the last control instead of stepping out of the dialog', () => {
  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={jest.fn()} />);

  const dialog = screen.getByRole('dialog');
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
  );
  const last = focusable[focusable.length - 1];
  last.focus();

  fireEvent.keyDown(document, { key: 'Tab' });

  // The browser's own action would have left the dialog; the wrap keeps the ring closed.
  expect(focusable[0]).toHaveFocus();
});

it('wraps Shift+Tab backwards from the first control', () => {
  render(<SourceNotePickerModal selectedNoteIds={[]} onSave={jest.fn()} onClose={jest.fn()} />);

  const dialog = screen.getByRole('dialog');
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
  );
  focusable[0].focus();

  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

  expect(focusable[focusable.length - 1]).toHaveFocus();
});

it('gives focus to the fallback when the opener has been disabled meanwhile', () => {
  const opener = document.createElement('button');
  const fallback = document.createElement('button');
  document.body.append(opener, fallback);
  fallback.focus();

  const { unmount } = render(
    <SourceNotePickerModal
      selectedNoteIds={[]}
      onSave={jest.fn()}
      onClose={jest.fn()}
      returnFocusTo={{ current: opener }}
    />
  );
  // A pending sync disables the menu button while the dialog is open; focusing a disabled
  // control does nothing, so focus would silently end up on the body.
  opener.disabled = true;

  unmount();

  expect(fallback).toHaveFocus();
  opener.remove();
  fallback.remove();
});
