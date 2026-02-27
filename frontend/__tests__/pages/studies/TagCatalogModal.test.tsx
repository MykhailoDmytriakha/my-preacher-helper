import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import TagCatalogModal from '@/(pages)/(private)/studies/TagCatalogModal';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('TagCatalogModal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    document.body.style.overflow = '';
  });

  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    availableTags: ['Grace', 'Faith', 'Mercy'],
    selectedTags: ['Faith'],
    onToggleTag: jest.fn(),
  };

  it('focuses search, filters tags, and toggles selection', async () => {
    render(<TagCatalogModal {...defaultProps} />);

    const input = screen.getByPlaceholderText('studiesWorkspace.tagCatalog.searchPlaceholder');
    jest.advanceTimersByTime(100);
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.change(input, { target: { value: 'mer' } });
    expect(screen.queryByRole('button', { name: /Grace/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mercy/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mercy/i }));
    expect(defaultProps.onToggleTag).toHaveBeenCalledWith('Mercy');
    expect(screen.getByText('studiesWorkspace.tagCatalog.selected:')).toBeInTheDocument();
  });

  it('shows no results and resets body scroll on close', () => {
    const { rerender } = render(<TagCatalogModal {...defaultProps} />);

    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.tagCatalog.searchPlaceholder'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('studiesWorkspace.tagCatalog.noResults')).toBeInTheDocument();

    rerender(<TagCatalogModal {...defaultProps} isOpen={false} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on backdrop click, Escape key, and done button', () => {
    const { rerender } = render(<TagCatalogModal {...defaultProps} />);

    fireEvent.mouseDown(document.querySelector('.absolute.inset-0') as Element);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(2);

    rerender(<TagCatalogModal {...defaultProps} selectedTags={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.tagCatalog.done' }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(3);
    expect(screen.getByText('studiesWorkspace.tagCatalog.noneSelected')).toBeInTheDocument();
  });
});
