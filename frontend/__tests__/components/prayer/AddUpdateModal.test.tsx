import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import AddUpdateModal from '@/components/prayer/AddUpdateModal';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'prayer.update.title': 'Add Update',
        'prayer.update.placeholder': 'Share an update',
        'prayer.update.cancel': 'Cancel',
        'prayer.update.submit': 'Save Update',
      };

      return translations[key] || key;
    },
  }),
}));

describe('AddUpdateModal', () => {
  it('submits trimmed text and closes after success', async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(<AddUpdateModal onClose={onClose} onSubmit={onSubmit} />);

    const submitButton = screen.getByRole('button', { name: 'Save Update' });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Share an update'), {
      target: { value: '  We prayed together  ' },
    });
    const enabledSubmitButton = await screen.findByRole('button', { name: 'Save Update' });
    expect(enabledSubmitButton).toBeEnabled();
    fireEvent.submit(enabledSubmitButton.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('We prayed together');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('shows submit errors and still allows manual cancel', async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn().mockRejectedValue(new Error('Save failed'));

    render(<AddUpdateModal onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Share an update'), {
      target: { value: 'Update text' },
    });
    const enabledSubmitButton = await screen.findByRole('button', { name: 'Save Update' });
    expect(enabledSubmitButton).toBeEnabled();
    fireEvent.submit(enabledSubmitButton.closest('form') as HTMLFormElement);

    expect(await screen.findByText('Save failed')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
