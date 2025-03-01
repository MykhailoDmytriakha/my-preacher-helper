import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Thought } from '@/models/models';
import ThoughtCard from '@/components/ThoughtCard';

// Mock dependencies
jest.mock('@/utils/dateFormatter', () => ({
  formatDate: jest.fn().mockReturnValue('01/01/2023'),
}));

jest.mock('@utils/color', () => ({
  getContrastColor: jest.fn().mockReturnValue('#ffffff'),
}));

// Mock the Icons component
jest.mock('@components/Icons', () => ({
  TrashIcon: () => <div data-testid="trash-icon" />,
  EditIcon: () => <div data-testid="edit-icon" />,
}));

// Mock the entire i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true });

// Mock the useTranslation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const translations: { [key: string]: string } = {
        'thought.tagsLabel': 'Tags',
        'thought.availableTags': 'Available tags',
        'thought.missingTags': 'Missing tags',
        'thought.missingRequiredTag': 'Missing required tag',
        'buttons.save': 'Save',
        'buttons.cancel': 'Cancel',
        'tags.introduction': 'Introduction',
        'tags.mainPart': 'Main Part',
        'tags.conclusion': 'Conclusion',
        'settings.title': 'Settings',
      };
      
      if (key === 'thought.missingRequiredTag' && options) {
        return `Please add one of these tags: ${options.intro}, ${options.main}, or ${options.conclusion}`;
      }
      
      return translations[key] || key;
    },
  }),
}));

describe('ThoughtCard Component', () => {
  // Default props for testing
  const mockThought: Thought = {
    id: 'thought-1',
    text: 'This is a test thought',
    tags: ['Tag1', 'Tag2'],
    date: '2023-01-01',
  };
  
  const mockAllowedTags = [
    { name: 'Tag1', color: '#ff0000' },
    { name: 'Tag2', color: '#00ff00' },
    { name: 'Вступление', color: '#0000ff' },
    { name: 'Основная часть', color: '#ff00ff' },
    { name: 'Заключение', color: '#00ffff' },
  ];
  
  const defaultProps = {
    thought: mockThought,
    index: 0,
    editingIndex: null,
    editingText: '',
    editingTags: [],
    hasRequiredTag: true,
    allowedTags: mockAllowedTags,
    currentTag: '',
    onDelete: jest.fn(),
    onEditStart: jest.fn(),
    onEditCancel: jest.fn(),
    onEditSave: jest.fn(),
    onTextChange: jest.fn(),
    onRemoveTag: jest.fn(),
    onAddTag: jest.fn(),
    onTagSelectorChange: jest.fn(),
    setCurrentTag: jest.fn(),
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('renders in view mode correctly', () => {
    render(<ThoughtCard {...defaultProps} />);
    
    // Check content
    expect(screen.getByText('This is a test thought')).toBeInTheDocument();
    
    // Check date
    expect(screen.getByText('01/01/2023')).toBeInTheDocument();
    
    // Check ID display
    expect(screen.getByText(`ID: ${mockThought.id}`)).toBeInTheDocument();
    
    // Check tags
    expect(screen.getByText('Tag1')).toBeInTheDocument();
    expect(screen.getByText('Tag2')).toBeInTheDocument();
    
    // Check icons
    expect(screen.getByTestId('trash-icon')).toBeInTheDocument();
    expect(screen.getByTestId('edit-icon')).toBeInTheDocument();
  });
  
  it('does not show warning when thought has required tag', () => {
    render(<ThoughtCard {...defaultProps} hasRequiredTag={true} />);
    
    // Should not find warning message
    expect(screen.queryByText(/Please add one of these tags/)).not.toBeInTheDocument();
  });
  
  it('shows warning when thought has no required tag', () => {
    render(<ThoughtCard {...defaultProps} hasRequiredTag={false} />);
    
    // Should find warning message
    expect(screen.getByText(/Please add one of these tags/)).toBeInTheDocument();
  });
  
  it('calls onDelete when delete button is clicked', () => {
    render(<ThoughtCard {...defaultProps} />);
    
    // Find and click delete button
    const deleteButton = screen.getByTestId('trash-icon').closest('button');
    fireEvent.click(deleteButton!);
    
    // Check if onDelete was called
    expect(defaultProps.onDelete).toHaveBeenCalledTimes(1);
    expect(defaultProps.onDelete).toHaveBeenCalledWith(0, 'thought-1');
  });
  
  it('calls onEditStart when edit button is clicked', () => {
    render(<ThoughtCard {...defaultProps} />);
    
    // Find and click edit button
    const editButton = screen.getByTestId('edit-icon').closest('button');
    fireEvent.click(editButton!);
    
    // Check if onEditStart was called
    expect(defaultProps.onEditStart).toHaveBeenCalledTimes(1);
    expect(defaultProps.onEditStart).toHaveBeenCalledWith(mockThought, 0);
  });
  
  it('renders in edit mode when editingIndex matches index', () => {
    render(
      <ThoughtCard 
        {...defaultProps} 
        editingIndex={0} 
        editingText="Edited text" 
        editingTags={['Tag1']} 
      />
    );
    
    // Should have textarea with editing text
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('Edited text');
    
    // Should have save and cancel buttons
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    
    // Should show tags in edit mode
    expect(screen.getByText('Tag1')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('Available tags')).toBeInTheDocument();
  });
  
  it('calls onTextChange when textarea value changes', () => {
    render(
      <ThoughtCard 
        {...defaultProps} 
        editingIndex={0} 
        editingText="Edited text" 
        editingTags={['Tag1']} 
      />
    );
    
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'New text' } });
    
    expect(defaultProps.onTextChange).toHaveBeenCalledTimes(1);
    expect(defaultProps.onTextChange).toHaveBeenCalledWith('New text');
  });
  
  it('calls onEditSave when save button is clicked', () => {
    render(
      <ThoughtCard 
        {...defaultProps} 
        editingIndex={0} 
        editingText="Edited text" 
        editingTags={['Tag1']} 
      />
    );
    
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    expect(defaultProps.onEditSave).toHaveBeenCalledTimes(1);
  });
  
  it('calls onEditCancel when cancel button is clicked', () => {
    render(
      <ThoughtCard 
        {...defaultProps} 
        editingIndex={0} 
        editingText="Edited text" 
        editingTags={['Tag1']} 
      />
    );
    
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    
    expect(defaultProps.onEditCancel).toHaveBeenCalledTimes(1);
  });
  
  it('calls onAddTag when clicking on an available tag', () => {
    render(
      <ThoughtCard 
        {...defaultProps} 
        editingIndex={0} 
        editingText="Edited text" 
        editingTags={['Tag1']} 
      />
    );
    
    // Find and click on an available tag
    const availableTag = screen.getByText('Tag2');
    fireEvent.click(availableTag);
    
    expect(defaultProps.onAddTag).toHaveBeenCalledTimes(1);
    expect(defaultProps.onAddTag).toHaveBeenCalledWith('Tag2');
  });
  
  it('calls onRemoveTag when clicking on an active tag', () => {
    render(
      <ThoughtCard 
        {...defaultProps} 
        editingIndex={0} 
        editingText="Edited text" 
        editingTags={['Tag1']} 
      />
    );
    
    // Find and click on an active tag
    const activeTag = screen.getByText('Tag1');
    fireEvent.click(activeTag);
    
    expect(defaultProps.onRemoveTag).toHaveBeenCalledTimes(1);
    expect(defaultProps.onRemoveTag).toHaveBeenCalledWith(0);
  });
  
  it('renders default tag styles when custom tag not found', () => {
    const thoughtWithDefaultTags: Thought = {
      id: 'thought-2',
      text: 'Thought with default tags',
      tags: ['Вступление', 'Основная часть', 'Заключение'],
      date: '2023-01-01',
    };
    
    render(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithDefaultTags}
        allowedTags={[]} // Empty to force default styling
      />
    );
    
    // Check all three default tags are rendered
    expect(screen.getByText('Вступление')).toBeInTheDocument();
    expect(screen.getByText('Основная часть')).toBeInTheDocument();
    expect(screen.getByText('Заключение')).toBeInTheDocument();
  });
}); 