import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import FormDialog, { FormActions } from '@/components/ui/FormDialog';

jest.unmock('react-dom');
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('names each dialog, describes it when provided, and closes only through explicit controls', () => {
  const close = jest.fn();
  const { rerender } = render(<FormDialog title="Create series" eyebrow="Series" description="Describe the series" onClose={close}><input aria-label="Title" /></FormDialog>);
  const dialog = screen.getByRole('dialog', { name: 'Create series' });
  expect(dialog).toHaveAccessibleDescription('Describe the series');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  fireEvent.click(dialog.parentElement!);
  expect(close).not.toHaveBeenCalled();
  const input = screen.getByRole('textbox');
  input.focus();
  fireEvent.change(input, { target: { value: 'Unfinished draft' } });
  rerender(<FormDialog title="Create group" eyebrow="Groups" tone="emerald" onClose={close}><input aria-label="Title" /></FormDialog>);
  expect(screen.getByRole('dialog', { name: 'Create group' })).not.toHaveAttribute('aria-describedby');
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input).toHaveFocus();
  expect(input).toHaveValue('Unfinished draft');
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  expect(close).toHaveBeenCalledTimes(1);
});

it('keeps cancel separate from form submission and disables only submission while saving', () => {
  const cancel = jest.fn();
  const submit = jest.fn(e => e.preventDefault());
  const contents = (saving: boolean) => <form onSubmit={submit}><FormActions onCancel={cancel} cancelLabel="Cancel" submitLabel="Save" saving={saving} tone="emerald" /></form>;
  const { rerender } = render(contents(false));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(submit).toHaveBeenCalledTimes(1);
  rerender(contents(true));
  fireEvent.click(screen.getByRole('button', { name: 'common.saving' }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'common.saving' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
});

it('allows opt-in backdrop dismissal, protects content clicks, and blocks every close control when requested', () => {
  const close = jest.fn();
  const props = { title: 'Prayer', eyebrow: 'Journal', onClose: close, dismissOnBackdrop: true, size: 'compact' as const, tone: 'rose' as const };
  const { rerender } = render(<FormDialog {...props}><textarea aria-label="Draft" /></FormDialog>);
  const dialog = screen.getByRole('dialog', { name: 'Prayer' });
  fireEvent.click(screen.getByRole('textbox'));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(dialog.parentElement!);
  expect(close).toHaveBeenCalledTimes(1);
  close.mockClear();
  rerender(<FormDialog {...props} closeDisabled><textarea aria-label="Draft" /></FormDialog>);
  expect(screen.getByRole('button', { name: 'common.close' })).toBeDisabled();
  fireEvent.click(dialog.parentElement!);
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  expect(close).not.toHaveBeenCalled();
});

it('supports independent validation and cancellation locks with a caller-specific saving label', () => {
  const props = { onCancel: jest.fn(), cancelLabel: 'Cancel', submitLabel: 'Add update', savingLabel: 'Saving update', tone: 'rose' as const };
  const { rerender } = render(<FormActions {...props} saving={false} submitDisabled cancelDisabled />);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add update' })).toBeDisabled();
  rerender(<FormActions {...props} saving />);
  expect(screen.getByRole('button', { name: 'Saving update' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('button', { name: 'Saving update' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
});

// Cancel discards the form's draft while the close button keeps it, so with changes made it asks first
// (BUG-20261003-one-click-delete-other-screens); with nothing changed it closes at once.
it('asks before Cancel throws away changes, and only then', async () => {
  const cancel = jest.fn();
  const props = { onCancel: cancel, cancelLabel: 'Cancel', submitLabel: 'Save', saving: false };
  const { rerender } = render(<FormActions {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'common.discardChanges.confirm' })).not.toBeInTheDocument();
  rerender(<FormActions {...props} unsaved />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByRole('dialog', { name: 'common.discardChanges.title' })).toHaveAccessibleDescription('common.discardChanges.description');
  fireEvent.click(screen.getByRole('button', { name: 'common.discardChanges.keep' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(cancel).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(await screen.findByRole('button', { name: 'common.discardChanges.confirm' }));
  await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
});
