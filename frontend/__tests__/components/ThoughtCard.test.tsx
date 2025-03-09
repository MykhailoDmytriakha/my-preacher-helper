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
        'thought.inconsistentSection': 'Inconsistency: thought has tag "{{actualTag}}" but assigned to {{expectedSection}} outline point',
        'thought.multipleStructureTags': 'Inconsistency: multiple structure tags detected. A thought should only have one structure tag.',
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
      
      if (key === 'thought.inconsistentSection' && options) {
        return `Inconsistency: thought has tag "${options.actualTag}" but assigned to ${options.expectedSection} outline point`;
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
    expect(screen.getByTestId('save-button')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
    
    // Should show tags in edit mode
    expect(screen.getByTestId('editing-tag-Tag1')).toBeInTheDocument();
    expect(screen.getByTestId('tags-section-header')).toBeInTheDocument();
    expect(screen.getByTestId('available-tags-header')).toBeInTheDocument();
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
    
    const saveButton = screen.getByTestId('save-button');
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
    
    const cancelButton = screen.getByTestId('cancel-button');
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
    const availableTag = screen.getByTestId('available-tag-Tag2');
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
    const activeTag = screen.getByTestId('editing-tag-Tag1');
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
    
    // Check all three default tags are rendered with their translated names
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Main Part')).toBeInTheDocument();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();
  });

  it('displays outline point when thought has outlinePointId and sermon outline is provided', () => {
    // Mock sermon outline
    const mockSermonOutline = {
      introduction: [{ id: 'intro-1', text: 'Introduction point 1' }],
      main: [{ id: 'main-1', text: 'Main point 1' }],
      conclusion: [{ id: 'concl-1', text: 'Conclusion point 1' }]
    };
    
    // Test with introduction point
    const thoughtWithIntroPoint: Thought = {
      id: 'thought-3',
      text: 'Thought with intro outline point',
      tags: ['Tag1'],
      date: '2023-01-01',
      outlinePointId: 'intro-1'
    };
    
    const { rerender } = render(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithIntroPoint}
        sermonOutline={mockSermonOutline}
      />
    );
    
    // Check that outline point is displayed with correct section
    expect(screen.getByText('Introduction: Introduction point 1')).toBeInTheDocument();
    
    // Test with main point
    const thoughtWithMainPoint: Thought = {
      ...thoughtWithIntroPoint,
      outlinePointId: 'main-1'
    };
    
    rerender(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithMainPoint}
        sermonOutline={mockSermonOutline}
      />
    );
    
    // Check that outline point is displayed with correct section
    expect(screen.getByText('Main Part: Main point 1')).toBeInTheDocument();
    
    // Test with conclusion point
    const thoughtWithConclPoint: Thought = {
      ...thoughtWithIntroPoint,
      outlinePointId: 'concl-1'
    };
    
    rerender(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithConclPoint}
        sermonOutline={mockSermonOutline}
      />
    );
    
    // Check that outline point is displayed with correct section
    expect(screen.getByText('Conclusion: Conclusion point 1')).toBeInTheDocument();
  });

  it('does not display outline point when thought has no outlinePointId', () => {
    // Mock sermon outline
    const mockSermonOutline = {
      introduction: [{ id: 'intro-1', text: 'Introduction point 1' }],
      main: [{ id: 'main-1', text: 'Main point 1' }],
      conclusion: [{ id: 'concl-1', text: 'Conclusion point 1' }]
    };
    
    // Thought without outlinePointId
    const thoughtWithoutOutlinePoint: Thought = {
      id: 'thought-4',
      text: 'Thought without outline point',
      tags: ['Tag1'],
      date: '2023-01-01',
      // No outlinePointId
    };
    
    render(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithoutOutlinePoint}
        sermonOutline={mockSermonOutline}
      />
    );
    
    // Check that no outline point section is displayed
    expect(screen.queryByText(/outline\.introduction/)).not.toBeInTheDocument();
    expect(screen.queryByText(/outline\.mainPoints/)).not.toBeInTheDocument();
    expect(screen.queryByText(/outline\.conclusion/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Introduction point 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Main point 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Conclusion point 1/)).not.toBeInTheDocument();
  });

  it('displays inconsistency warning when thought has tag inconsistent with outline point section', () => {
    // Mock sermon outline
    const mockSermonOutline = {
      introduction: [{ id: 'intro-1', text: 'Introduction point 1' }],
      main: [{ id: 'main-1', text: 'Main point 1' }],
      conclusion: [{ id: 'concl-1', text: 'Conclusion point 1' }]
    };
    
    // Thought with tag from different section than outline point
    const thoughtWithInconsistentTag: Thought = {
      id: 'thought-5',
      text: 'Thought with inconsistent tag',
      tags: ['Вступление'], // Introduction tag
      date: '2023-01-01',
      outlinePointId: 'main-1' // But assigned to main point
    };
    
    render(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithInconsistentTag}
        sermonOutline={mockSermonOutline}
        hasRequiredTag={true}
      />
    );
    
    // Check that inconsistency warning is displayed
    expect(screen.getByText(/Inconsistency: thought has tag/)).toBeInTheDocument();
    
    // Check that card has red border styling
    const cardElement = screen.getByText('Thought with inconsistent tag').closest('div');
    expect(cardElement).toHaveClass('border-red-500');
  });
  
  it('displays multiple structure tags warning when thought has multiple structure tags', () => {
    // Thought with multiple structure tags
    const thoughtWithMultipleTags: Thought = {
      id: 'thought-6',
      text: 'Thought with multiple structure tags',
      tags: ['Вступление', 'Основная часть'], // Both Introduction and Main Part tags
      date: '2023-01-01'
    };
    
    render(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithMultipleTags}
        hasRequiredTag={true}
      />
    );
    
    // Check that multiple tags warning is displayed
    expect(screen.getByText(/Inconsistency: multiple structure tags detected/)).toBeInTheDocument();
    
    // Check that card has red border styling
    const cardElement = screen.getByText('Thought with multiple structure tags').closest('div');
    expect(cardElement).toHaveClass('border-red-500');
  });
  
  it('does not display warnings when thought has consistent tags and section', () => {
    // Mock sermon outline
    const mockSermonOutline = {
      introduction: [{ id: 'intro-1', text: 'Introduction point 1' }],
      main: [{ id: 'main-1', text: 'Main point 1' }],
      conclusion: [{ id: 'concl-1', text: 'Conclusion point 1' }]
    };
    
    // Thought with consistent tag and outline point
    const consistentThought: Thought = {
      id: 'thought-7',
      text: 'Thought with consistent tag',
      tags: ['Вступление'], // Introduction tag
      date: '2023-01-01',
      outlinePointId: 'intro-1' // Assigned to intro point
    };
    
    render(
      <ThoughtCard 
        {...defaultProps} 
        thought={consistentThought}
        sermonOutline={mockSermonOutline}
        hasRequiredTag={true}
      />
    );
    
    // Check that no inconsistency warning is displayed
    expect(screen.queryByText(/Inconsistency/)).not.toBeInTheDocument();
    
    // Check that card does not have red border styling
    const cardElement = screen.getByText('Thought with consistent tag').closest('div');
    expect(cardElement).not.toHaveClass('border-red-500');
  });
}); 