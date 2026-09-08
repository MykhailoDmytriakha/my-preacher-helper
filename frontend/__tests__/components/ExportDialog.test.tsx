import { fireEvent, render, screen } from '@testing-library/react';

import { ExportDialog } from '@/components/export-buttons/ExportDialog';
import { FormButton } from '@/components/ui/FormDialog';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('keeps controls and actions available during preparation and shows the prepared document afterward', () => {
  const close = jest.fn();
  const download = jest.fn();
  const props = { format: 'TXT' as const, title: 'Export text', onClose: close, controls: <button>Markdown</button>, actions: <FormButton onClick={download}>Download</FormButton> };
  const { rerender } = render(<ExportDialog {...props} isLoading>Preview</ExportDialog>);
  expect(screen.getByRole('dialog', { name: 'Export text' })).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('common.loading');
  expect(screen.getByRole('button', { name: 'Markdown' })).toBeVisible();
  rerender(<ExportDialog {...props} isLoading={false}>Prepared text</ExportDialog>);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText('Prepared text')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  expect(download).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});

it('uses the wide PDF presentation and replaces invalid preview content with an accessible error', () => {
  render(<ExportDialog format="PDF" title="Export PDF" onClose={jest.fn()} isLoading={false} error="Could not prepare this document" actions={<FormButton disabled>Download</FormButton>}>Stale preview</ExportDialog>);
  expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-4xl');
  expect(screen.getByRole('alert')).toHaveTextContent('Could not prepare this document');
  expect(screen.queryByText('Stale preview')).toBeNull();
  expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
});
