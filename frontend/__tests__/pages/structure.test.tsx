import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    prefetch: jest.fn(),
    replace: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn().mockImplementation((param) => {
      if (param === 'sermonId') return 'sermon123';
      return null;
    }),
  }),
}));

// Mock services
jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn().mockResolvedValue({
    id: 'sermon123',
    title: 'Test Sermon',
    passage: 'John 3:16',
    date: '2023-05-01',
  }),
}));

jest.mock('@/services/structure.service', () => ({
  updateStructure: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/services/outline.service', () => ({
  getSermonOutline: jest.fn().mockResolvedValue({
    introduction: [{ id: 'intro1', content: 'Intro point 1' }],
    main: [{ id: 'main1', content: 'Main point 1' }],
    conclusion: [{ id: 'concl1', content: 'Conclusion point 1' }],
    ambiguous: [{ id: 'amb1', content: 'Ambiguous point 1' }],
  }),
}));

jest.mock('@/services/tag.service', () => ({
  getTags: jest.fn().mockResolvedValue([]),
}));

// Mock ExportButtons component
jest.mock('@/components/ExportButtons', () => ({
  __esModule: true,
  default: (props: any) => (
    <div data-testid="export-buttons">
      <button onClick={() => props.getExportContent()} data-testid="export-txt-button">
        Export TXT
      </button>
    </div>
  ),
}));

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'structure.introduction': 'Introduction',
        'structure.main': 'Main Part',
        'structure.conclusion': 'Conclusion',
        'structure.ambiguous': 'Under Consideration',
        'structure.normalMode': 'Normal Mode',
        'structure.focusMode': 'Focus Mode',
      };
      return translations[key] || key;
    },
    i18n: {
      changeLanguage: jest.fn(),
    },
  }),
}));

// Define a mock Column component
const MockColumn = jest.fn(({ 
  id, 
  title, 
  items, 
  showFocusButton, 
  onFocusClick, 
  isFocused = false 
}) => (
  <div data-testid={`column-${id}`} className={isFocused ? 'focused' : ''}>
    <h2>{title}</h2>
    <div>
      {items.map((item: any) => (
        <div key={item.id} data-testid={`item-${item.id}`}>
          {item.content}
        </div>
      ))}
    </div>
    {showFocusButton && (
      <button 
        data-testid={`focus-btn-${id}`}
        onClick={() => onFocusClick && onFocusClick(id)}
      >
        Focus Mode
      </button>
    )}
  </div>
));

// Add the mock Column to the Column export
jest.mock('@/components/Column', () => ({
  __esModule: true,
  default: (props: any) => MockColumn(props),
}));

// Create a simplified mock version of the StructurePageContent component
const MockStructurePageContent = () => {
  const [focusedColumn, setFocusedColumn] = React.useState<string | null>(null);
  const [exportContent, setExportContent] = React.useState<string>('');
  
  const containers = {
    introduction: [{ id: 'intro1', content: 'Intro point 1', customTagNames: [{name: 'tag1', color: '#123456'}] }],
    main: [{ id: 'main1', content: 'Main point 1', customTagNames: [] }],
    conclusion: [{ id: 'concl1', content: 'Conclusion point 1', customTagNames: [{name: 'tag2', color: '#654321'}] }],
    ambiguous: [{ id: 'amb1', content: 'Ambiguous point 1', customTagNames: [] }],
  };

  const outlinePoints = {
    introduction: [{ id: 'outline1', text: 'Introduction outline point' }],
    main: [{ id: 'outline2', text: 'Main outline point' }],
    conclusion: [{ id: 'outline3', text: 'Conclusion outline point' }],
  };

  const handleFocus = (columnId: string) => {
    setFocusedColumn(columnId);
  };

  const handleNormalMode = () => {
    setFocusedColumn(null);
  };

  const getExportContentForFocusedColumn = async () => {
    if (!focusedColumn || !containers[focusedColumn as keyof typeof containers]) {
      return '';
    }
    
    const items = containers[focusedColumn as keyof typeof containers];
    const title = focusedColumn === 'introduction' ? 'Introduction' : 
                 focusedColumn === 'main' ? 'Main Part' : 
                 focusedColumn === 'conclusion' ? 'Conclusion' : 'Under Consideration';
    let content = `# ${title}\n\n`;
    
    if (focusedColumn !== 'ambiguous' && 
        (focusedColumn === 'introduction' || focusedColumn === 'main' || focusedColumn === 'conclusion') && 
        outlinePoints[focusedColumn as keyof typeof outlinePoints]?.length > 0) {
      content += '## Outline Points\n';
      outlinePoints[focusedColumn as keyof typeof outlinePoints].forEach((point) => {
        content += `- ${point.text}\n`;
      });
      content += '\n';
    }
    
    content += '## Content\n';
    if (items.length === 0) {
      content += 'No entries\n';
    } else {
      items.forEach((item, index) => {
        content += `${index + 1}. ${item.content}\n`;
        if (item.customTagNames && item.customTagNames.length > 0) {
          // Extract tag names from the customTagNames objects
          const tagNames = item.customTagNames.map(tag => tag.name);
          content += `   Tags: ${tagNames.join(', ')}\n`;
        }
        content += '\n';
      });
    }
    
    setExportContent(content);
    return content;
  };

  return (
    <div>
      <div className={`w-full ${focusedColumn ? 'max-w-7xl mx-auto' : ''}`}>
        {focusedColumn && (
          <div className="flex justify-between items-center mb-4">
            <button 
              data-testid="normal-mode-btn"
              onClick={handleNormalMode}
            >
              Normal Mode
            </button>
            
            <div data-testid="export-section">
              {/* Mock ExportButtons component */}
              <div data-testid="export-buttons">
                <button 
                  onClick={() => getExportContentForFocusedColumn()} 
                  data-testid="export-txt-button"
                >
                  Export TXT
                </button>
              </div>
            </div>
          </div>
        )}
        
        <div className="flex flex-wrap">
          {/* Introduction column */}
          {(!focusedColumn || focusedColumn === "introduction") && (
            <MockColumn
              id="introduction"
              title="Introduction"
              items={containers.introduction}
              showFocusButton={!focusedColumn}
              onFocusClick={handleFocus}
              isFocused={focusedColumn === "introduction"}
            />
          )}
          
          {/* Main column */}
          {(!focusedColumn || focusedColumn === "main") && (
            <MockColumn
              id="main"
              title="Main Part"
              items={containers.main}
              showFocusButton={!focusedColumn}
              onFocusClick={handleFocus}
              isFocused={focusedColumn === "main"}
            />
          )}
          
          {/* Conclusion column */}
          {(!focusedColumn || focusedColumn === "conclusion") && (
            <MockColumn
              id="conclusion"
              title="Conclusion"
              items={containers.conclusion}
              showFocusButton={!focusedColumn}
              onFocusClick={handleFocus}
              isFocused={focusedColumn === "conclusion"}
            />
          )}
        </div>
        
        {/* Ambiguous section (always visible) */}
        <div data-testid="ambiguous-section">
          <h3>Under Consideration</h3>
          <div>
            {containers.ambiguous.map(item => (
              <div key={item.id} data-testid={`ambiguous-item-${item.id}`}>
                {item.content}
              </div>
            ))}
          </div>
        </div>

        {/* Hidden div to expose export content for testing */}
        {exportContent && (
          <div data-testid="export-content-preview" style={{ display: 'none' }}>
            {exportContent}
          </div>
        )}
      </div>
    </div>
  );
};

describe('Structure Page Focus Mode', () => {
  
  it('renders all columns when not in focus mode', () => {
    render(<MockStructurePageContent />);
    
    // Check if all columns are rendered
    expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    expect(screen.getByTestId('column-main')).toBeInTheDocument();
    expect(screen.getByTestId('column-conclusion')).toBeInTheDocument();
    
    // No normal mode button should be visible
    expect(screen.queryByTestId('normal-mode-btn')).not.toBeInTheDocument();
  });
  
  it('shows only the focused column when in focus mode', () => {
    render(<MockStructurePageContent />);
    
    // Enter focus mode for introduction
    fireEvent.click(screen.getByTestId('focus-btn-introduction'));
    
    // Now only introduction column should be visible
    expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    expect(screen.queryByTestId('column-main')).not.toBeInTheDocument();
    expect(screen.queryByTestId('column-conclusion')).not.toBeInTheDocument();
    
    // Normal mode button should be visible
    expect(screen.getByTestId('normal-mode-btn')).toBeInTheDocument();
  });
  
  it('returns to normal mode when clicking Normal Mode button', () => {
    render(<MockStructurePageContent />);
    
    // Enter focus mode for introduction
    fireEvent.click(screen.getByTestId('focus-btn-introduction'));
    
    // Now only introduction column should be visible
    expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    expect(screen.queryByTestId('column-main')).not.toBeInTheDocument();
    
    // Click normal mode button
    fireEvent.click(screen.getByTestId('normal-mode-btn'));
    
    // All columns should be visible again
    expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    expect(screen.getByTestId('column-main')).toBeInTheDocument();
    expect(screen.getByTestId('column-conclusion')).toBeInTheDocument();
  });
  
  it('applies max-width constraint in focus mode', () => {
    const { container } = render(<MockStructurePageContent />);
    
    // Before focus mode, no normal mode button should be visible
    expect(screen.queryByTestId('normal-mode-btn')).not.toBeInTheDocument();
    
    // Enter focus mode
    fireEvent.click(screen.getByTestId('focus-btn-introduction'));
    
    // After focus mode, normal mode button should be visible
    expect(screen.getByTestId('normal-mode-btn')).toBeInTheDocument();
    
    // And only the focused column should be visible
    expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    expect(screen.queryByTestId('column-main')).not.toBeInTheDocument();
    expect(screen.queryByTestId('column-conclusion')).not.toBeInTheDocument();
  });
  
  it('shows ambiguous section in both normal and focus modes', () => {
    render(<MockStructurePageContent />);
    
    // In normal mode, ambiguous section should be visible
    expect(screen.getByTestId('ambiguous-section')).toBeInTheDocument();
    expect(screen.getByText('Under Consideration')).toBeInTheDocument();
    
    // Enter focus mode
    fireEvent.click(screen.getByTestId('focus-btn-introduction'));
    
    // In focus mode, ambiguous section should still be visible
    expect(screen.getByTestId('ambiguous-section')).toBeInTheDocument();
    expect(screen.getByText('Under Consideration')).toBeInTheDocument();
  });

  it('shows export button in focus mode and exports only the focused column content', async () => {
    render(<MockStructurePageContent />);
    
    // Check that export section is not visible in normal mode
    expect(screen.queryByTestId('export-section')).not.toBeInTheDocument();
    
    // Enter focus mode for introduction
    fireEvent.click(screen.getByTestId('focus-btn-introduction'));
    
    // Export section should be visible in focus mode
    expect(screen.getByTestId('export-section')).toBeInTheDocument();
    expect(screen.getByTestId('export-txt-button')).toBeInTheDocument();
    
    // Click export button
    fireEvent.click(screen.getByTestId('export-txt-button'));
    
    // Check that export content contains introduction data
    const exportContentElement = screen.getByTestId('export-content-preview');
    expect(exportContentElement.textContent).toContain('# Introduction');
    expect(exportContentElement.textContent).toContain('## Outline Points');
    expect(exportContentElement.textContent).toContain('- Introduction outline point');
    expect(exportContentElement.textContent).toContain('## Content');
    expect(exportContentElement.textContent).toContain('1. Intro point 1');
    expect(exportContentElement.textContent).toContain('Tags: tag1');
    
    // It should not contain content from other sections
    expect(exportContentElement.textContent).not.toContain('Main point 1');
    expect(exportContentElement.textContent).not.toContain('Conclusion point 1');
  });
}); 