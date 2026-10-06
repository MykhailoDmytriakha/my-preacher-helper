import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import { LocalizedToaster } from '@/components/LocalizedToaster';

describe('the notification area', () => {
  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
  });

  it('is named in the interface language, not by the library default', () => {
    const { container } = render(<LocalizedToaster />);
    // The global i18n mock returns the key; sonner appends its hotkey hint.
    expect(container.querySelector('section')?.getAttribute('aria-label')).toMatch(/^common\.notifications /);
  });

  it('names the close button of a shown notification in the interface language', async () => {
    render(<LocalizedToaster />);
    act(() => {
      toast.error('Not saved');
    });

    // The global i18n mock returns the key, so the label is the key itself, never sonner's "Close toast".
    expect(await screen.findByRole('button', { name: 'common.closeNotification' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close toast' })).not.toBeInTheDocument();
  });
});
