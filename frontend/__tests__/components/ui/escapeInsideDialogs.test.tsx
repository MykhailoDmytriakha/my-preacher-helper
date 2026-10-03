import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import DatePickerField from '@/components/ui/DatePickerField';
import FormDialog from '@/components/ui/FormDialog';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import '@testing-library/jest-dom';

/**
 * ONE ESCAPE, ONE THING CLOSES (BUG-20261003-escape-cancelling-inner-action-closes-dialog).
 *
 * A part of a window that answers Escape itself — a calendar popover, an inline field, a keyboard
 * drag — stops the press, so the window around it stays open. Everything else lets Escape close the
 * window. `defaultPrevented` cannot tell the two apart: ProseMirror prevents every Escape without
 * doing anything, and a window keyed on it stopped closing from every rich-text field.
 */
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key, i18n: { language: 'en' } }),
}));
jest.mock('react-day-picker/dist/style.css', () => ({}));

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  });
});

it('closes only the calendar of a date field, not the form it sits in', () => {
  const onClose = jest.fn();
  render(<FormDialog title="Date form" onClose={onClose}><DatePickerField id="date" value="2026-10-03" onChange={jest.fn()} /></FormDialog>);
  fireEvent.click(screen.getByLabelText('Open calendar'));
  expect(screen.getByTestId('date-calendar-popover')).toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape', code: 'Escape', keyCode: 27 });

  expect(screen.queryByTestId('date-calendar-popover')).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

it('closes the form on Escape from the ProseMirror engine, which prevents every Escape it sees', () => {
  const onClose = jest.fn();
  render(<FormDialog title="Editor form" onClose={onClose}><div data-testid="engine" /></FormDialog>);
  const editor = new Editor({ element: screen.getByTestId('engine'), extensions: [StarterKit], content: '<p>Draft text</p>' });
  try {
    const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true });
    fireEvent(editor.view.dom, event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    editor.destroy();
  }
});

it('closes the form on Escape from the app rich-text editor', async () => {
  const onClose = jest.fn();
  render(<FormDialog title="Rich form" onClose={onClose}><RichMarkdownEditor value="Draft text" onChange={jest.fn()} /></FormDialog>);
  await waitFor(() => expect(document.querySelector('[contenteditable="true"]')).not.toBeNull());

  fireEvent.keyDown(document.querySelector('[contenteditable="true"]')!, { key: 'Escape', code: 'Escape', keyCode: 27 });

  expect(onClose).toHaveBeenCalledTimes(1);
});
