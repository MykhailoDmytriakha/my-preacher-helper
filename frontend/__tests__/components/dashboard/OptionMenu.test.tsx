import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import OptionMenu from '@/components/dashboard/OptionMenu';
import { Sermon } from '@/models/models';
import { deleteSermon } from '@services/sermon.service';

// Mock dependencies
jest.mock('@services/sermon.service', () => ({
  deleteSermon: jest.fn().mockResolvedValue({}),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: jest.fn(),
  }),
}));

// Mock the Icons component
jest.mock('@components/Icons', () => ({
  DotsVerticalIcon: () => <div data-testid="dots-vertical-icon" />,
}));

// Mock the EditSermonModal component
jest.mock('@components/EditSermonModal', () => {
  return function MockEditSermonModal({ 
    onClose, 
    onUpdate, 
    sermon 
  }: { 
    onClose: () => void; 
    onUpdate: (sermon: Sermon) => void; 
    sermon: Sermon 
  }) {
    return (
      <div data-testid="edit-sermon-modal">
        <button onClick={() => onClose()}>Close</button>
        <button onClick={() => onUpdate({ ...sermon, title: 'Updated Sermon' })}>Update</button>
      </div>
    );
  };
});

// Mock the entire i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true });

// Mock the useTranslation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'optionMenu.options': 'Options',
        'optionMenu.edit': 'Edit',
        'optionMenu.delete': 'Delete',
        'optionMenu.deleteConfirm': 'Are you sure you want to delete this sermon?',
        'optionMenu.deleteError': 'Error deleting sermon',
      };
      
      return translations[key] || key;
    },
  }),
}));

describe('OptionMenu Component', () => {
  // Default mock sermon
  const mockSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: [],
    userId: 'user-1', // Add the required userId property
  };
  
  const defaultProps = {
    sermon: mockSermon,
    onDelete: jest.fn(),
    onUpdate: jest.fn(),
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock window.confirm to always return true
    window.confirm = jest.fn().mockImplementation(() => true);
  });
  
  it('renders correctly with the menu button', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Check the menu button is rendered
    expect(screen.getByTestId('dots-vertical-icon')).toBeInTheDocument();
  });
  
  it('shows options when menu is clicked', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Click the menu button
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Check options are displayed
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
  
  it('hides menu when clicked outside', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <OptionMenu {...defaultProps} />
      </div>
    );
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Ensure menu is open
    expect(screen.getByText('Edit')).toBeInTheDocument();
    
    // Click outside
    fireEvent.click(screen.getByTestId('outside'));
    
    // Menu should close
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });
  
  it('opens edit modal when Edit button is clicked', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Edit
    fireEvent.click(screen.getByText('Edit'));
    
    // Check modal is shown
    expect(screen.getByTestId('edit-sermon-modal')).toBeInTheDocument();
  });
  
  it('calls onUpdate with updated sermon when sermon is updated', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Edit
    fireEvent.click(screen.getByText('Edit'));
    
    // Click Update in modal
    fireEvent.click(screen.getByText('Update'));
    
    // Check onUpdate was called
    expect(defaultProps.onUpdate).toHaveBeenCalledTimes(1);
    expect(defaultProps.onUpdate).toHaveBeenCalledWith({ 
      ...mockSermon, 
      title: 'Updated Sermon' 
    });
  });
  
  it('closes edit modal when Close button is clicked', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Edit
    fireEvent.click(screen.getByText('Edit'));
    
    // Modal should be open
    expect(screen.getByTestId('edit-sermon-modal')).toBeInTheDocument();
    
    // Click Close in modal
    fireEvent.click(screen.getByText('Close'));
    
    // Modal should close
    expect(screen.queryByTestId('edit-sermon-modal')).not.toBeInTheDocument();
  });
  
  it('calls onDelete with sermon ID when Delete is clicked and confirmed', async () => {
    // Mock deleteSermon to resolve immediately so we can await it
    (deleteSermon as jest.Mock).mockImplementation(async () => {
      return Promise.resolve({});
    });
    
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Delete
    fireEvent.click(screen.getByText('Delete'));
    
    // Check confirm was called
    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to delete this sermon?');
    
    // Check deleteSermon service was called
    expect(deleteSermon).toHaveBeenCalledWith('sermon-1');
    
    // Wait for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Check onDelete was called
    expect(defaultProps.onDelete).toHaveBeenCalledWith('sermon-1');
  });
  
  it('does not delete sermon when confirmation is canceled', async () => {
    // Mock confirm to return false this time
    window.confirm = jest.fn().mockImplementation(() => false);
    
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Delete
    fireEvent.click(screen.getByText('Delete'));
    
    // Check deleteSermon service was not called
    expect(deleteSermon).not.toHaveBeenCalled();
    
    // Check onDelete was not called
    expect(defaultProps.onDelete).not.toHaveBeenCalled();
  });
}); 