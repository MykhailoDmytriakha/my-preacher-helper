import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Column from '@/components/Column';
import { Item } from '@/models/models';

// Mock the i18next library
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key: string) => {
        const translations: Record<string, string> = {
          'structure.focusMode': 'Focus Mode',
          'structure.normalMode': 'Normal Mode',
          'structure.noEntries': 'No entries'
        };
        return translations[key] || key;
      }
    };
  }
}));

describe('Column Component', () => {
  const mockItems: Item[] = [
    { id: '1', content: 'Item 1', customTagNames: [] },
    { id: '2', content: 'Item 2', customTagNames: [] }
  ];

  it('renders correctly in normal mode', () => {
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems} 
      />
    );
    
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('displays focus button when showFocusButton is true', () => {
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        showFocusButton={true}
        onToggleFocusMode={() => {}}
      />
    );
    
    expect(screen.getByText('Focus Mode')).toBeInTheDocument();
  });

  it('does not display focus button when showFocusButton is false', () => {
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        showFocusButton={false}
      />
    );
    
    expect(screen.queryByText('Focus Mode')).not.toBeInTheDocument();
  });

  it('displays Normal Mode text when in focus mode', () => {
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        showFocusButton={true}
        isFocusMode={true}
        onToggleFocusMode={() => {}}
      />
    );
    
    expect(screen.getByText('Normal Mode')).toBeInTheDocument();
  });

  it('calls onToggleFocusMode when focus button is clicked', () => {
    const mockToggleFocus = jest.fn();
    
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        showFocusButton={true}
        isFocusMode={false}
        onToggleFocusMode={mockToggleFocus}
      />
    );
    
    fireEvent.click(screen.getByText('Focus Mode'));
    expect(mockToggleFocus).toHaveBeenCalledWith('introduction');
  });

  it('displays items in a vertical list layout when in focus mode', () => {
    const { container } = render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        showFocusButton={true}
        isFocusMode={true}
        onToggleFocusMode={() => {}}
      />
    );
    
    // Check that the space-y-3 class is applied for vertical spacing in focus mode
    const itemsContainer = container.querySelector('.space-y-3');
    expect(itemsContainer).toBeInTheDocument();
  });

  it('renders custom class name when provided', () => {
    const { container } = render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        className="custom-class"
      />
    );
    
    const columnContainer = container.firstChild;
    expect(columnContainer).toHaveClass('custom-class');
  });

  it('shows outline points when provided', () => {
    const outlinePoints = [
      { id: '1', text: 'Point 1' },
      { id: '2', text: 'Point 2' }
    ];
    
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        outlinePoints={outlinePoints}
      />
    );
    
    expect(screen.getByText('Point 1')).toBeInTheDocument();
    expect(screen.getByText('Point 2')).toBeInTheDocument();
  });

  it('displays no entries message when items array is empty', () => {
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={[]}
      />
    );
    
    expect(screen.getByText('No entries')).toBeInTheDocument();
  });
}); 