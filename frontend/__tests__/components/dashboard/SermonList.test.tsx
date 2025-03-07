import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SermonList from '@/components/dashboard/SermonList';
import { Sermon } from '@/models/models';

// Mock child components
jest.mock('@/components/dashboard/OptionMenu', () => {
  return function MockOptionMenu({ sermon, onDelete, onUpdate }: { 
    sermon: Sermon; 
    onDelete: (id: string) => void; 
    onUpdate: (updatedSermon: Sermon) => void; 
  }) {
    return (
      <div data-testid="option-menu">
        <button 
          data-testid={`delete-sermon-${sermon.id}`} 
          onClick={() => onDelete(sermon.id)}
        >
          Delete
        </button>
        <button 
          data-testid={`update-sermon-${sermon.id}`} 
          onClick={() => onUpdate({ ...sermon, title: 'Updated Title' })}
        >
          Update
        </button>
      </div>
    );
  };
});

jest.mock('@components/ExportButtons', () => {
  return function MockExportButtons({ sermonId }: { sermonId: string }) {
    return <div data-testid={`export-buttons-${sermonId}`}>Export Buttons</div>;
  };
});

// Mock the Icons component
jest.mock('@components/Icons', () => ({
  DocumentIcon: () => <div data-testid="document-icon" />,
}));

// Mock utility functions
jest.mock('@utils/dateFormatter', () => ({
  formatDate: jest.fn().mockImplementation((date) => `Formatted: ${date}`),
}));

jest.mock('@/utils/exportContent', () => ({
  exportSermonContent: jest.fn().mockReturnValue('Exported content'),
}));

// Mock the entire i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true });

// Mock the useTranslation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'dashboard.thought': 'Thought',
        'dashboard.thoughts': 'Thoughts',
        'dashboard.hasOutline': 'Has outline',
      };
      
      return translations[key] || key;
    },
  }),
}));

// Mock Next.js Link
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid="next-link">
      {children}
    </a>
  );
});

describe('SermonList Component', () => {
  // Create mock sermons
  const mockSermons: Sermon[] = [
    {
      id: 'sermon-1',
      title: 'Sermon 1',
      verse: 'Matthew 5:1-12',
      date: '2023-01-01',
      thoughts: [{ id: 'thought-1', text: 'Thought 1', date: '2023-01-01', tags: [] }],
      userId: 'user-1',
      outline: {
        introduction: [{ id: 'intro-1', text: 'Intro point 1' }],
        main: [{ id: 'main-1', text: 'Main point 1' }],
        conclusion: [{ id: 'conclusion-1', text: 'Conclusion point 1' }],
      },
    },
    {
      id: 'sermon-2',
      title: 'Sermon 2',
      verse: 'John 3:16',
      date: '2023-02-01',
      thoughts: [], // No thoughts
      userId: 'user-1',
      outline: undefined, // No outline
    },
  ];
  
  const defaultProps = {
    sermons: mockSermons,
    onDelete: jest.fn(),
    onUpdate: jest.fn(),
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('renders a list of sermons correctly', () => {
    render(<SermonList {...defaultProps} />);
    
    // Check sermon titles are displayed
    expect(screen.getByText('Sermon 1')).toBeInTheDocument();
    expect(screen.getByText('Sermon 2')).toBeInTheDocument();
    
    // Check verses are displayed
    expect(screen.getByText('Matthew 5:1-12')).toBeInTheDocument();
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    
    // Check formatted dates are displayed
    expect(screen.getByText('Formatted: 2023-01-01')).toBeInTheDocument();
    expect(screen.getByText('Formatted: 2023-02-01')).toBeInTheDocument();
  });
  
  it('shows thought count correctly', () => {
    render(<SermonList {...defaultProps} />);
    
    // First sermon has 1 thought
    expect(screen.getByText('1 Thought')).toBeInTheDocument();
    
    // Second sermon has 0 thoughts
    expect(screen.getByText('0 Thoughts')).toBeInTheDocument();
  });
  
  it('displays "Has outline" badge for sermons with outlines', () => {
    render(<SermonList {...defaultProps} />);
    
    // First sermon has an outline
    const badges = screen.getAllByText('Has outline');
    expect(badges).toHaveLength(1); // Only the first sermon has an outline
  });
  
  it('does not display "Has outline" badge for sermons without outlines', () => {
    render(<SermonList {...defaultProps} />);
    
    // Check that we have the correct number of sermon cards
    const sermonLinks = screen.getAllByTestId('next-link');
    expect(sermonLinks).toHaveLength(2);
    
    // Check the second sermon (the one without an outline)
    const sermonCards = screen.getAllByRole('link');
    const secondSermonCard = sermonCards[1];
    
    // No "Has outline" badge in the second sermon card
    expect(secondSermonCard.textContent).not.toContain('Has outline');
  });
  
  it('renders the OptionMenu for each sermon', () => {
    render(<SermonList {...defaultProps} />);
    
    // Check we have two option menus (one for each sermon)
    const optionMenus = screen.getAllByTestId('option-menu');
    expect(optionMenus).toHaveLength(2);
  });
  
  it('renders the ExportButtons for each sermon', () => {
    render(<SermonList {...defaultProps} />);
    
    // Check export buttons are present for both sermons
    expect(screen.getByTestId('export-buttons-sermon-1')).toBeInTheDocument();
    expect(screen.getByTestId('export-buttons-sermon-2')).toBeInTheDocument();
  });
  
  it('calls onDelete with sermon ID when delete is triggered', () => {
    render(<SermonList {...defaultProps} />);
    
    // Trigger delete from OptionMenu
    fireEvent.click(screen.getByTestId('delete-sermon-sermon-1'));
    
    // Check onDelete prop was called with the right sermon ID
    expect(defaultProps.onDelete).toHaveBeenCalledWith('sermon-1');
  });
  
  it('calls onUpdate with updated sermon when update is triggered', () => {
    render(<SermonList {...defaultProps} />);
    
    // Trigger update from OptionMenu
    fireEvent.click(screen.getByTestId('update-sermon-sermon-2'));
    
    // Check onUpdate prop was called with the right sermon
    expect(defaultProps.onUpdate).toHaveBeenCalledWith({
      ...mockSermons[1],
      title: 'Updated Title',
    });
  });
}); 