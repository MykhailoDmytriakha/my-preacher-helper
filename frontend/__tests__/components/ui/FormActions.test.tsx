import { render, screen } from '@testing-library/react';
import React from 'react';

import { FormActions } from '@/components/ui/FormDialog';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * A ROW OF BUTTONS MUST NOT RESHUFFLE ITSELF MID-PRESS.
 *
 * "Save" turning into "Saving…" made the button a third wider, which slid Cancel sideways
 * under a finger already on its way down — and, caught mid-repaint, printed the two states
 * over each other in the owner's screenshot.
 */
const renderActions = (saving: boolean) =>
  render(
    <FormActions
      onCancel={jest.fn()}
      cancelLabel="Отмена"
      submitLabel="Сохранить"
      saving={saving}
    />
  );

describe('the actions row keeps its shape while it works', () => {
  it('reserves room for the longer wording before it is needed', () => {
    renderActions(false);

    expect(screen.getByRole('button', { name: 'Сохранить' }).className).toContain('min-w-');
  });

  it('still reserves it while saving, so nothing slides', () => {
    renderActions(true);

    expect(screen.getByRole('button', { name: /common.saving/ }).className).toContain('min-w-');
  });

  it('says out loud that the work is running', () => {
    renderActions(true);

    expect(screen.getByRole('button', { name: /common.saving/ })).toHaveAttribute('aria-busy', 'true');
  });

  it('leaves the way out open while it saves', () => {
    // Deliberate, and frozen here as well as in FormDialog.test.tsx: a person may always walk
    // away from a dialog. A refused write reports itself on the row afterwards.
    renderActions(true);

    expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled();
  });
});
