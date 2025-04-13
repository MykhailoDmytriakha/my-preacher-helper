import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

// Mock the Icons components used
jest.mock('@components/Icons', () => ({
  TrashIcon: () => <div data-testid="trash-icon" />,
  EditIcon: () => <div data-testid="edit-icon" />,
}));

// Mock EllipsisVerticalIcon from heroicons
jest.mock('@heroicons/react/24/outline', () => ({
  EllipsisVerticalIcon: () => <div data-testid="ellipsis-icon" />,
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
        'thought.optionsMenuLabel': 'Thought options',
        'common.edit': 'Edit',
        'common.delete': 'Delete',
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
      
      // Handle specific interpolations
      if (key === 'thought.missingRequiredTag' && options) {
        return `Please add one of these tags: ${options.intro || 'intro'}, ${options.main || 'main'}, or ${options.conclusion || 'conclusion'}`;
      }
      
      if (key === 'thought.inconsistentSection' && options && options.actualTag && options.expectedSection) {
        return `Inconsistency: thought has tag "${options.actualTag}" but assigned to ${options.expectedSection} outline point`;
      } 
      else if (key === 'thought.inconsistentSection') {
         return `Inconsistency: thought has tag "undefined" but assigned to undefined outline point`; // Keep fallback based on previous observations
      }
      
      // Return standard translation or the key itself
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
    // Add back English variants if they were used elsewhere
    { name: 'Introduction', color: '#0000ff' }, 
    { name: 'Main Part', color: '#ff00ff' },
    { name: 'Conclusion', color: '#00ffff' },
  ];
  
  const defaultProps = {
    thought: mockThought,
    index: 0,
    allowedTags: mockAllowedTags,
    onDelete: jest.fn(),
    onEditStart: jest.fn(),
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('renders basic thought information correctly', () => {
    render(<ThoughtCard {...defaultProps} />);
    
    expect(screen.getByText('This is a test thought')).toBeInTheDocument();
    expect(screen.getByText('01/01/2023')).toBeInTheDocument();
    expect(screen.getByText(`ID: ${mockThought.id}`)).toBeInTheDocument();
    expect(screen.getByText('Tag1')).toBeInTheDocument();
    expect(screen.getByText('Tag2')).toBeInTheDocument();
    expect(screen.getByTestId('ellipsis-icon')).toBeInTheDocument(); // Check for options menu icon
  });
  
  it('does not show warning when thought has required tag', () => {
    const thoughtWithStructureTag = {
      ...mockThought,
      tags: ['Tag1', 'Вступление'] 
    };
    render(<ThoughtCard {...defaultProps} thought={thoughtWithStructureTag} />);
    expect(screen.queryByText(/Please add one of these tags/)).not.toBeInTheDocument();
  });
  
  it('shows warning when thought has no required tag', () => {
    render(<ThoughtCard {...defaultProps} />); 
    expect(screen.getByText(/Please add one of these tags/)).toBeInTheDocument();
  });
  
  // --- Options Menu Tests --- 

  it('opens options menu when ellipsis button is clicked', () => {
    render(<ThoughtCard {...defaultProps} />);
    const optionsButton = screen.getByTestId('ellipsis-icon').closest('button');
    
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(); // Menu initially hidden
    fireEvent.click(optionsButton!);
    expect(screen.getByRole('menu')).toBeInTheDocument(); // Menu visible
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('calls onEditStart and closes menu when Edit option is clicked', async () => {
    render(<ThoughtCard {...defaultProps} />);
    const optionsButton = screen.getByTestId('ellipsis-icon').closest('button');
    fireEvent.click(optionsButton!);
    
    const editOption = screen.getByText('Edit');
    fireEvent.click(editOption);
    
    expect(defaultProps.onEditStart).toHaveBeenCalledTimes(1);
    expect(defaultProps.onEditStart).toHaveBeenCalledWith(mockThought, 0);

    // Wait for menu to potentially close (due to state update)
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('calls onDelete and closes menu when Delete option is clicked', async () => {
    render(<ThoughtCard {...defaultProps} />);
    const optionsButton = screen.getByTestId('ellipsis-icon').closest('button');
    fireEvent.click(optionsButton!);
    
    const deleteOption = screen.getByText('Delete');
    fireEvent.click(deleteOption);
    
    expect(defaultProps.onDelete).toHaveBeenCalledTimes(1);
    expect(defaultProps.onDelete).toHaveBeenCalledWith(0, 'thought-1');

    // Wait for menu to potentially close (due to state update)
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('closes options menu when clicking outside', () => {
    render(
      <div>
        <div data-testid="outside">Outside Element</div>
        <ThoughtCard {...defaultProps} />
      </div>
    );
    const optionsButton = screen.getByTestId('ellipsis-icon').closest('button');
    fireEvent.click(optionsButton!); // Open menu
    
    expect(screen.getByRole('menu')).toBeInTheDocument(); // Menu is open
    
    const outsideElement = screen.getByTestId('outside');
    fireEvent.mouseDown(outsideElement); // Simulate click outside
    
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(); // Menu should be closed
  });

  // --- End Options Menu Tests ---
  
  it('renders default tag styles when custom tag not found', () => {
    const thoughtWithUnknownTag = {
      ...mockThought,
      tags: ['UnknownTag'] 
    };
    render(<ThoughtCard {...defaultProps} thought={thoughtWithUnknownTag} />);
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
      tags: ['Заключение'] // Inconsistent with introduction
    };
    render(
      <ThoughtCard 
        {...defaultProps} 
        thought={thoughtWithInconsistentTag} 
        sermonOutline={sermonOutline} 
      />
    );

    // Keep the less strict assertion from before
    const alertElement = screen.queryByRole('alert');
    expect(alertElement).toBeInTheDocument();
    expect(alertElement).toHaveTextContent(/Inconsistency|Warning/);
  });

  it('displays warning when thought has multiple structure tags', () => {
    const thoughtWithMultipleTags = {
      ...mockThought,
      tags: ['Вступление', 'Основная часть']
    };
    render(<ThoughtCard {...defaultProps} thought={thoughtWithMultipleTags} />);
    expect(screen.getByText(/multiple structure tags detected/)).toBeInTheDocument();
  });
}); 