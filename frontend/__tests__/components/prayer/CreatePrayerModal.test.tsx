import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CreatePrayerModal from '@/components/prayer/CreatePrayerModal';
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
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        })
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

  it('shows the submit error message when saving fails', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('Save failed'));

    render(<CreatePrayerModal onClose={jest.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('What are you praying for?'), {
      target: { value: 'Pray for family' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Prayer' }));

    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Add Prayer' })).toBeInTheDocument();
  });
});
