import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import '@testing-library/jest-dom';
import SettingsNav from '@components/settings/SettingsNav';

// --- Mocks --- //

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Simple mock
  }),
}));

// --- Test Suite --- //

describe('SettingsNav', () => {
  const mockOnNavigate = jest.fn();
  const mockOnSectionChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderNav = (props: Partial<React.ComponentProps<typeof SettingsNav>>) => {
    const defaultProps: React.ComponentProps<typeof SettingsNav> = {
        activeSection: 'user', // Default active section
        // Provide mocks based on what the test needs
    };
    return render(<SettingsNav {...defaultProps} {...props} />);
  };

  it('renders section buttons correctly', () => {
    renderNav({});
    expect(screen.getByRole('button', { name: /settings.userSettings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settings.manageTags/i })).toBeInTheDocument();
  });

  it('highlights the active section - user', () => {
    renderNav({ activeSection: 'user' });
    const userButton = screen.getByRole('button', { name: /settings.userSettings/i });
    const tagsButton = screen.getByRole('button', { name: /settings.manageTags/i });

    // Check classes or styles indicating active state
    // Using a simple check for background class - adjust if styling differs
    expect(userButton).toHaveClass('bg-blue-600'); 
    expect(tagsButton).not.toHaveClass('bg-blue-600');
    expect(tagsButton).toHaveClass('hover:bg-gray-100'); // Check inactive style
  });

   it('highlights the active section - tags', () => {
     renderNav({ activeSection: 'tags' });
     const userButton = screen.getByRole('button', { name: /settings.userSettings/i });
     const tagsButton = screen.getByRole('button', { name: /settings.manageTags/i });

     expect(userButton).not.toHaveClass('bg-blue-600');
     expect(userButton).toHaveClass('hover:bg-gray-100');
     expect(tagsButton).toHaveClass('bg-blue-600');
   });

  it('calls onSectionChange when provided and a button is clicked', async () => {
    renderNav({ onSectionChange: mockOnSectionChange, onNavigate: mockOnNavigate });
    const tagsButton = screen.getByRole('button', { name: /settings.manageTags/i });

    await userEvent.click(tagsButton);

    expect(mockOnSectionChange).toHaveBeenCalledTimes(1);
    expect(mockOnSectionChange).toHaveBeenCalledWith('tags');
    expect(mockOnNavigate).not.toHaveBeenCalled(); // Should prefer onSectionChange
  });

  it('calls onNavigate when onSectionChange is not provided and a button is clicked', async () => {
    renderNav({ onSectionChange: undefined, onNavigate: mockOnNavigate }); // Explicitly undefined
    const userButton = screen.getByRole('button', { name: /settings.userSettings/i });

    await userEvent.click(userButton);

    expect(mockOnNavigate).toHaveBeenCalledTimes(1);
    expect(mockOnNavigate).toHaveBeenCalledWith('user');
    expect(mockOnSectionChange).not.toHaveBeenCalled();
  });

  it('does nothing if neither callback is provided', async () => {
    renderNav({ onSectionChange: undefined, onNavigate: undefined });
    const tagsButton = screen.getByRole('button', { name: /settings.manageTags/i });

    await userEvent.click(tagsButton);

    expect(mockOnNavigate).not.toHaveBeenCalled();
    expect(mockOnSectionChange).not.toHaveBeenCalled();
  });
}); 