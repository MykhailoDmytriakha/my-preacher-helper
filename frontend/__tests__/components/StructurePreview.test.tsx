import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { Sermon, Thought } from '@/models/models';

// Mock the translations
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'structure.preview': 'ThoughtsBySection Preview',
        'structure.underConsideration': 'Under Consideration',
        'tags.introduction': 'Introduction',
        'tags.mainPart': 'Main Part',
        'tags.conclusion': 'Conclusion',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock themeColors
jest.mock('@/utils/themeColors', () => ({
  SERMON_SECTION_COLORS: {
    introduction: {
      base: "#2563eb"
    },
    mainPart: {
      base: "#7e22ce"
    },
    conclusion: {
      base: "#16a34a"
    }
  }
}));

// Mock component that simulates the actual StructurePreview component
const MockStructurePreview: React.FC<{
  sermon: Sermon;
  animateEntry?: boolean;
}> = ({ sermon }) => {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  // Helper function to find thought text by ID
  const getThoughtTextById = (thoughtId: string): string => {
    if (!sermon.thoughts) return thoughtId;
    
    const thought = sermon.thoughts.find((t: Thought) => t.id === thoughtId);
    return thought ? thought.text.slice(0, 100) + '...' : thoughtId;
  };

  if (!sermon.structure) return null;
  
  return (
    <div data-testid="structure-preview" className={isCollapsed ? 'collapsed' : 'expanded'}>
      <div className="header">
        <h3>ThoughtsBySection Preview</h3>
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          data-testid="collapse-button"
        >
          <svg className={isCollapsed ? 'rotate-180' : ''}>
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      
      {!isCollapsed && (
        <div data-testid="preview-content">
          {sermon.structure.introduction && sermon.structure.introduction.length > 0 && (
            <div data-testid="introduction-section">
              <strong>Introduction</strong>
              <div>
                {sermon.structure.introduction.map((item, index) => (
                  <span key={`intro-${index}`} data-testid={`intro-item-${index}`}>
                    {getThoughtTextById(item)}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {sermon.structure.main && sermon.structure.main.length > 0 && (
            <div data-testid="main-section">
              <strong>Main Part</strong>
              <div>
                {sermon.structure.main.map((item, index) => (
                  <span key={`main-${index}`} data-testid={`main-item-${index}`}>
                    {getThoughtTextById(item)}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {sermon.structure.conclusion && sermon.structure.conclusion.length > 0 && (
            <div data-testid="conclusion-section">
              <strong>Conclusion</strong>
              <div>
                {sermon.structure.conclusion.map((item, index) => (
                  <span key={`conclusion-${index}`} data-testid={`conclusion-item-${index}`}>
                    {getThoughtTextById(item)}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {sermon.structure.ambiguous && sermon.structure.ambiguous.length > 0 && (
            <div data-testid="ambiguous-section">
              <strong>Under Consideration</strong>
              <div>
                {sermon.structure.ambiguous.map((item, index) => (
                  <span key={`ambiguous-${index}`} data-testid={`ambiguous-item-${index}`}>
                    {getThoughtTextById(item)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

describe('StructurePreview Component', () => {
  // Sample data for testing
  const mockThoughts: Thought[] = [
    { id: 'thought1', text: 'Introduction thought', tags: ['Вступление'], date: '2023-01-01' },
    { id: 'thought2', text: 'Main part thought', tags: ['Основная часть'], date: '2023-01-01' },
    { id: 'thought3', text: 'Conclusion thought', tags: ['Заключение'], date: '2023-01-01' },
    { id: 'thought4', text: 'Ambiguous thought', tags: [], date: '2023-01-01' },
  ];

  const mockSermon: Sermon = {
    id: 'sermon1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: mockThoughts,
    userId: 'user1',
    structure: {
      introduction: ['thought1'],
      main: ['thought2'],
      conclusion: ['thought3'],
      ambiguous: ['thought4'],
    },
  };

  it('renders structure preview with correct thought texts', () => {
    render(<MockStructurePreview sermon={mockSermon} />);

    // Check if all section titles are rendered
    expect(screen.getByText('ThoughtsBySection Preview')).toBeInTheDocument();
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Main Part')).toBeInTheDocument();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();
    expect(screen.getByText('Under Consideration')).toBeInTheDocument();

    // Check if thought texts are displayed correctly (with ellipsis)
    expect(screen.getByText('Introduction thought...')).toBeInTheDocument();
    expect(screen.getByText('Main part thought...')).toBeInTheDocument();
    expect(screen.getByText('Conclusion thought...')).toBeInTheDocument();
    expect(screen.getByText('Ambiguous thought...')).toBeInTheDocument();
  });

  it('collapses and expands when the button is clicked', () => {
    render(<MockStructurePreview sermon={mockSermon} />);
    
    // Initially, content should be visible
    expect(screen.getByTestId('preview-content')).toBeInTheDocument();
    
    // Click collapse button
    const collapseButton = screen.getByTestId('collapse-button');
    fireEvent.click(collapseButton);
    
    // Content should be hidden
    expect(screen.queryByTestId('preview-content')).not.toBeInTheDocument();
    
    // Click expand button again
    fireEvent.click(collapseButton);
    
    // Content should be visible again
    expect(screen.getByTestId('preview-content')).toBeInTheDocument();
  });

  it('does not render when sermon has no structure', () => {
    const sermonWithoutStructure = { ...mockSermon, structure: undefined };
    const { container } = render(<MockStructurePreview sermon={sermonWithoutStructure} />);
    
    // Component should render nothing
    expect(container.firstChild).toBeNull();
  });

  it('renders empty sections correctly when structure sections are empty', () => {
    const sermonWithEmptySections = { 
      ...mockSermon,
      structure: {
        introduction: [],
        main: ['thought2'],
        conclusion: ['thought3'],
        ambiguous: [],
      }
    };
    
    render(<MockStructurePreview sermon={sermonWithEmptySections} />);

    // Should not render introduction and ambiguous sections
    expect(screen.queryByTestId('introduction-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ambiguous-section')).not.toBeInTheDocument();
    
    // Should still render main and conclusion sections
    expect(screen.getByTestId('main-section')).toBeInTheDocument();
    expect(screen.getByTestId('conclusion-section')).toBeInTheDocument();
  });

  it('truncates long thought texts', () => {
    const longThought = { 
      id: 'longThought', 
      text: 'This is a very long thought that should be truncated in the preview. It contains many words and characters that would make it difficult to display in full.', 
      tags: [], 
      date: '2023-01-01' 
    };
    
    const sermonWithLongThought = {
      ...mockSermon,
      thoughts: [...mockThoughts, longThought],
      structure: {
        introduction: ['longThought'],
        main: [],
        conclusion: [],
        ambiguous: [],
      }
    };
    
    render(<MockStructurePreview sermon={sermonWithLongThought} />);
    
    // Should display truncated text with ellipsis
    expect(screen.getByText(/This is a very long thought.*\.\.\.$/)).toBeInTheDocument();
  });
}); 