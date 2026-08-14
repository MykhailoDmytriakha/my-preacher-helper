import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CreatePrayerModal from '@/components/prayer/CreatePrayerModal';
import { persistedWrite } from '@/utils/recoverableWrite';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'prayer.create.title': 'New Prayer Request',
        'prayer.create.titleLabel': 'Prayer Request',
        'prayer.create.titlePlaceholder': 'What are you praying for?',
        'prayer.create.descriptionLabel': 'Additional Context',
        'prayer.create.descriptionPlaceholder': 'Optional notes...',
        'prayer.create.tagsLabel': 'Tags',
        'prayer.create.tagsPlaceholder': 'family, health, evangelism',
        'prayer.create.submit': 'Add Prayer',
        'prayer.create.cancel': 'Cancel',
        'buttons.saving': 'Saving...',
        'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
      };

      return translations[key] || key;
    },
  }),
}));

describe('CreatePrayerModal', () => {
  it('uses the localized tags placeholder', () => {
    render(<CreatePrayerModal onClose={jest.fn()} onSubmit={jest.fn()} />);

    expect(
      screen.getByPlaceholderText('family, health, evangelism')
    ).toBeInTheDocument();
  });

  it('shows a stable saving label instead of replacing the button text with dots', async () => {
    let resolveSubmit: (() => void) | undefined;
    const onSubmit = jest.fn(
      () =>
        persistedWrite(new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }))
    );

    render(<CreatePrayerModal onClose={jest.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('What are you praying for?'), {
      target: { value: 'Pray for family' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Prayer' }));

    const submitButton = await screen.findByRole('button', { name: 'Saving...' });
    expect(submitButton).toHaveAttribute('aria-busy', 'true');
    expect(submitButton).toHaveTextContent('Saving...');
    expect(submitButton).not.toHaveTextContent(/^\.{3}$/);

    resolveSubmit?.();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the modal in saving state after success when closeOnSuccess is false', async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn(() => persistedWrite(Promise.resolve()));

    render(
      <CreatePrayerModal
        onClose={onClose}
        onSubmit={onSubmit}
        closeOnSuccess={false}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('What are you praying for?'), {
      target: { value: 'Pray for family' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Prayer' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'New Prayer Request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('does NOT repeat the failure — the prayer recovery descriptor owns that message', async () => {
    /**
     * This used to assert the opposite: that the modal renders the raw error text. That is
     * exactly the defect — every prayer write has a `useWriteRecovery` descriptor which
     * reports terminal failures with the person's text and a retry, so the modal's own
     * message made one failed save arrive as two, one of them untranslated technical
     * wording. What the editor owes is below: stay open, keep the text, stay usable.
     */
    const onSubmit = jest.fn(() => persistedWrite(Promise.reject(new Error('Save failed'))));
    const onClose = jest.fn();

    render(<CreatePrayerModal onClose={onClose} onSubmit={onSubmit} />);

    const title = screen.getByPlaceholderText('What are you praying for?');
    fireEvent.change(title, { target: { value: 'Pray for family' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Prayer' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText('Save failed')).not.toBeInTheDocument();
    expect(title).toHaveValue('Pray for family');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add Prayer' })).toBeEnabled();
  });

  it('keeps the exact prayer edit in the open editor when refused', async () => {
    const refusal = Object.assign(new Error('Permission denied'), { code: 'firestore/permission-denied' });
    const onClose = jest.fn();
    const onSubmit = jest.fn(() => persistedWrite(Promise.reject(refusal)));

    render(
      <CreatePrayerModal
        mode="edit"
        initialValues={{ title: 'Old title', description: 'Old description' }}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );

    const title = screen.getByDisplayValue('Old title');
    const description = screen.getByDisplayValue('Old description');
    fireEvent.change(title, { target: { value: 'Exact refused prayer title' } });
    fireEvent.change(description, { target: { value: 'Exact refused prayer description' } });
    fireEvent.click(screen.getByRole('button', { name: 'prayer.edit.submit' }));

    // AWAITED first: these assertions used to run on the same tick as the click, before
    // the rejected promise reached `catch` — so they would have stayed green even if the
    // catch had started closing the editor and taking the only visible copy with it.
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    // The MESSAGE now belongs to this entity's recovery descriptor — one refusal, one
    // reporter (docs/recoverable-writes.md). What the EDITOR owes the person is checked
    // below: it stays open, holding exactly what they typed.
    expect(title).toHaveValue('Exact refused prayer title');
    expect(description).toHaveValue('Exact refused prayer description');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('passes every raw editor field to recovery before normalising the persisted payload', async () => {
    const onSubmit = jest.fn(() => persistedWrite(Promise.resolve()));

    render(<CreatePrayerModal onClose={jest.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('What are you praying for?'), {
      target: { value: '  Pray for the family  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Optional notes...'), {
      target: { value: '  Exact context with spaces  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('family, health, evangelism'), {
      target: { value: ' family,  health  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Prayer' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Pray for the family',
      description: 'Exact context with spaces',
      tags: ['family', 'health'],
      recoveryDraft: '  Pray for the family  \n  Exact context with spaces  \n family,  health  ',
    }));
  });
});
