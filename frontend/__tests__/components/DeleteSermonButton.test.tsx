import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DeleteSermonButton from '@components/DeleteSermonButton';
import { deleteSermon } from '@services/sermon.service';

// Mock the next/navigation module
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  })),
}));

// Mock the sermon service
jest.mock('@services/sermon.service', () => ({
  deleteSermon: jest.fn(),
}));

describe('DeleteSermonButton', () => {
  const sermonId = 'test-sermon-id';
  let windowConfirmSpy: jest.SpyInstance;
  let windowAlertSpy: jest.SpyInstance;
  let originalLocation: Location;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    // Spy on window.confirm
    windowConfirmSpy = jest.spyOn(window, 'confirm').mockImplementation(jest.fn());
    // Spy on window.alert
    windowAlertSpy = jest.spyOn(window, 'alert').mockImplementation(jest.fn());
    
    // --- Safer window.location.href mock --- 
    originalLocation = window.location;
    // Delete the existing location property to allow redefining
    delete (window as Partial<Window>).location;
    // Define a new location object with a configurable href
    window.location = { 
        ...originalLocation, // Spread existing properties
        href: '', 
        assign: jest.fn(), // Mock assign if needed
        replace: jest.fn(), // Mock replace if needed
    };
    // Use Object.defineProperty to make href writable within tests
    // Object.defineProperty(window.location, 'href', {
    //     writable: true,
    //     value: '',
    // });
    // --- End safer mock ---
  });

  afterEach(() => {
    // Restore mocks after each test
    windowConfirmSpy.mockRestore();
    windowAlertSpy.mockRestore();
    // Restore original window.location
    window.location = originalLocation;
  });

  it('renders the default button with text', () => {
    render(<DeleteSermonButton sermonId={sermonId} />);
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  });

  it('renders the icon button when iconOnly is true', () => {
    render(<DeleteSermonButton sermonId={sermonId} iconOnly />);
    expect(screen.getByRole('button', { name: '🗑️' })).toBeInTheDocument();
  });

  it('renders a non-clickable span when iconOnly and noAction are true', () => {
    render(<DeleteSermonButton sermonId={sermonId} iconOnly noAction />);
    expect(screen.getByText('🗑️')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls deleteSermon and redirects on successful deletion (default button)', async () => {
    windowConfirmSpy.mockReturnValue(true);
    (deleteSermon as jest.Mock).mockResolvedValue(undefined);

    render(<DeleteSermonButton sermonId={sermonId} />);
    const button = screen.getByRole('button', { name: 'Удалить' });
    fireEvent.click(button);

    // Check confirmation
    expect(windowConfirmSpy).toHaveBeenCalledWith('Вы уверены, что хотите удалить проповедь?');

    // Check loading state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Удаление...' })).toBeDisabled();
    });

    // Check service call
    expect(deleteSermon).toHaveBeenCalledWith(sermonId);

    // Check redirection
    await waitFor(() => {
       // replace, not an href assignment: assigning pushes a history entry and leaves the
    // deleted sermon's page one Back away — BUG-20260905.
    expect(window.location.replace).toHaveBeenCalledWith('/sermons');
    });

     // Check button state reverts (though it redirects immediately)
     await waitFor(() => {
       // This check might be flaky due to immediate redirect, but we ensure it's attempted
       expect(screen.getByRole('button', { name: 'Удалить' })).toBeEnabled();
     });
  });

   it('calls deleteSermon and redirects on successful deletion (icon button)', async () => {
    windowConfirmSpy.mockReturnValue(true);
    (deleteSermon as jest.Mock).mockResolvedValue(undefined);

    render(<DeleteSermonButton sermonId={sermonId} iconOnly />);
    const button = screen.getByRole('button', { name: '🗑️' });
    fireEvent.click(button);

    expect(windowConfirmSpy).toHaveBeenCalledWith('Вы уверены, что хотите удалить проповедь?');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '...' })).toBeDisabled();
    });

    expect(deleteSermon).toHaveBeenCalledWith(sermonId);

    await waitFor(() => {
       // replace, not an href assignment: assigning pushes a history entry and leaves the
    // deleted sermon's page one Back away — BUG-20260905.
    expect(window.location.replace).toHaveBeenCalledWith('/sermons');
    });

     await waitFor(() => {
       expect(screen.getByRole('button', { name: '🗑️' })).toBeEnabled();
     });
  });


  it('does not call deleteSermon if confirmation is cancelled', () => {
    windowConfirmSpy.mockReturnValue(false);

    render(<DeleteSermonButton sermonId={sermonId} />);
    const button = screen.getByRole('button', { name: 'Удалить' });
    fireEvent.click(button);

    expect(windowConfirmSpy).toHaveBeenCalledWith('Вы уверены, что хотите удалить проповедь?');
    expect(deleteSermon).not.toHaveBeenCalled();
    expect(window.location.href).toBe('');
  });

   it('handles error during deletion and shows alert', async () => {
    windowConfirmSpy.mockReturnValue(true);
    const errorMessage = 'Test error';
    (deleteSermon as jest.Mock).mockRejectedValue(new Error(errorMessage));

    render(<DeleteSermonButton sermonId={sermonId} />);
    const button = screen.getByRole('button', { name: 'Удалить' });
    fireEvent.click(button);

    expect(windowConfirmSpy).toHaveBeenCalledWith('Вы уверены, что хотите удалить проповедь?');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Удаление...' })).toBeDisabled();
    });

    expect(deleteSermon).toHaveBeenCalledWith(sermonId);

    await waitFor(() => {
      expect(windowAlertSpy).toHaveBeenCalledWith('Не удалось удалить проповедь');
    });

    // Check button reverts to original state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Удалить' })).toBeEnabled();
    });
     expect(window.location.href).toBe(''); // No redirect on error
  });

    it('does not trigger delete when noAction is true', () => {
    render(<DeleteSermonButton sermonId={sermonId} iconOnly noAction />);
    const iconSpan = screen.getByText('🗑️');

    // Try clicking (although it's not a button, just to be sure)
    fireEvent.click(iconSpan);

    expect(windowConfirmSpy).not.toHaveBeenCalled();
    expect(deleteSermon).not.toHaveBeenCalled();
  });
}); 