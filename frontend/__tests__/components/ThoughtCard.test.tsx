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

// Mock the tagUtils module
jest.mock('@utils/tagUtils', () => ({
  isStructureTag: jest.fn().mockImplementation(tag => 
    ['Вступление', 'Основная часть', 'Заключение', 'Introduction', 'Main Part', 'Conclusion'].includes(tag)
  ),
  getDefaultTagStyling: jest.fn().mockReturnValue({ backgroundColor: '#333333', color: '#ffffff' }),
  getStructureIcon: jest.fn().mockReturnValue(null),
  getTagStyle: jest.fn().mockReturnValue({ backgroundColor: '#333333', color: '#ffffff' }),
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
    { name: 'Introduction', color: '#0000ff' },
    { name: 'Main Part', color: '#ff00ff' },
    { name: 'Conclusion', color: '#00ffff' },
  ];
  
  const defaultProps = {
    thought: mockThought,
    index: 0,
    allowedTags: mockAllowedTags,
    currentTag: '',
    onDelete: jest.fn(),
    onEditStart: jest.fn(),
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
    const thoughtWithStructureTag = {
      ...mockThought,
      tags: ['Tag1', 'Вступление'] // Using the Russian tag that's recognized by the implementation
    };
    
    render(<ThoughtCard {...defaultProps} thought={thoughtWithStructureTag} />);
    
    // Should not find warning message
    expect(screen.queryByText(/Please add one of these tags/)).not.toBeInTheDocument();
  });
  
  it('shows warning when thought has no required tag', () => {
    render(<ThoughtCard {...defaultProps} />); // Default thought has no structure tags
    
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
  
  it('renders default tag styles when custom tag not found', () => {
    const thoughtWithUnknownTag = {
      ...mockThought,
      tags: ['UnknownTag'] // This tag doesn't exist in allowedTags
    };
    
    render(<ThoughtCard {...defaultProps} thought={thoughtWithUnknownTag} />);
    
    // The tag should still be rendered with default styling
    expect(screen.getByText('UnknownTag')).toBeInTheDocument();
  });
  
  it('displays outline point when thought has outlinePointId and sermon outline is provided', () => {
    const outlinePoint = {
      id: 'point-1',
      text: 'Test outline point',
      order: 1
    };
    
    const sermonOutline = {
      id: 'outline-1',
      title: 'Test Outline',
      introduction: [outlinePoint],
      main: [],
      conclusion: []
    };
    
    const thoughtWithOutlinePoint = {
      ...mockThought,
      outlinePointId: 'point-1'
    };
    
    render(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithOutlinePoint} 
        sermonOutline={sermonOutline} 
      />
    );
    
    // Check for the combined text that includes both the section name and outline point text
    expect(screen.getByText(/Introduction: Test outline point/)).toBeInTheDocument();
  });
  
  it('does not display outline point when thought has no outlinePointId', () => {
    const sermonOutline = {
      id: 'outline-1',
      title: 'Test Outline',
      introduction: [{
        id: 'point-1',
        text: 'Test outline point',
        order: 1
      }],
      main: [],
      conclusion: []
    };
    
    render(
      <ThoughtCard 
        {...defaultProps} 
        sermonOutline={sermonOutline} 
      />
    );
    
    // The outline point text should not be displayed
    expect(screen.queryByText(/Test outline point/)).not.toBeInTheDocument();
  });
  
  it('displays inconsistency warning when thought has tag inconsistent with outline point section', () => {
    const outlinePoint = {
      id: 'point-1',
      text: 'Test outline point',
      order: 1
    };
    
    const sermonOutline = {
      id: 'outline-1',
      title: 'Test Outline',
      introduction: [outlinePoint],
      main: [],
      conclusion: []
    };
    
    const thoughtWithInconsistentTag = {
      ...mockThought,
      outlinePointId: 'point-1',
      tags: ['Заключение'] // This is inconsistent with the introduction section
    };
    
    render(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithInconsistentTag} 
        sermonOutline={sermonOutline} 
      />
    );
    
    // Should show inconsistency warning
    expect(screen.getByText(/Inconsistency/)).toBeInTheDocument();
  });
  
  it('displays multiple structure tags warning when thought has multiple structure tags', () => {
    const thoughtWithMultipleStructureTags = {
      ...mockThought,
      tags: ['Вступление', 'Заключение'] // Multiple structure tags
    };
    
    render(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithMultipleStructureTags} 
      />
    );
    
    // Should show multiple structure tags warning
    expect(screen.getByText(/multiple structure tags detected/)).toBeInTheDocument();
  });
  
  it('does not display warnings when thought has consistent tags and section', () => {
    const outlinePoint = {
      id: 'point-1',
      text: 'Test outline point',
      order: 1
    };
    
    const sermonOutline = {
      id: 'outline-1',
      title: 'Test Outline',
      introduction: [outlinePoint],
      main: [],
      conclusion: []
    };
    
    const thoughtWithConsistentTag = {
      ...mockThought,
      outlinePointId: 'point-1',
      tags: ['Вступление'] // This is consistent with the introduction section
    };
    
    render(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithConsistentTag} 
        sermonOutline={sermonOutline} 
      />
    );
    
    // Should not show any warning
    expect(screen.queryByText(/Inconsistency/)).not.toBeInTheDocument();
    expect(screen.queryByText(/multiple structure tags/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Please add one of these tags/)).not.toBeInTheDocument();
  });
}); 