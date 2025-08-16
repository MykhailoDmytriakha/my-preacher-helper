import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Import the structure layout component
const StructureLayout = require('../../app/(pages)/(private)/structure/layout').default;

describe('Structure Layout', () => {
  it('should render children without additional wrapper elements', () => {
    const testContent = <div data-testid="test-content">Test Structure Content</div>;
    
    const { container } = render(
      <StructureLayout>
        {testContent}
      </StructureLayout>
    );
    
    // The layout should render the children directly
    expect(screen.getByTestId('test-content')).toBeInTheDocument();
    expect(screen.getByText('Test Structure Content')).toBeInTheDocument();
    
    // The layout should not add any wrapper divs around children
    // It should just render the children directly
    expect(container.firstChild).toBe(screen.getByTestId('test-content'));
  });

  it('should handle multiple children correctly', () => {
    const multipleChildren = (
      <>
        <div data-testid="structure-header">Structure Header</div>
        <div data-testid="structure-content">Structure Content</div>
        <div data-testid="structure-footer">Structure Footer</div>
      </>
    );
    
    render(
      <StructureLayout>
        {multipleChildren}
      </StructureLayout>
    );
    
    // All children should be rendered
    expect(screen.getByTestId('structure-header')).toBeInTheDocument();
    expect(screen.getByTestId('structure-content')).toBeInTheDocument();
    expect(screen.getByTestId('structure-footer')).toBeInTheDocument();
    
    expect(screen.getByText('Structure Header')).toBeInTheDocument();
    expect(screen.getByText('Structure Content')).toBeInTheDocument();
    expect(screen.getByText('Structure Footer')).toBeInTheDocument();
  });

  it('should handle empty children gracefully', () => {
    const { container } = render(<StructureLayout>{null}</StructureLayout>);
    
    // When children is null, the component should render without crashing
    // but may not render any visible content
    expect(container).toBeInTheDocument();
    
    // The container should exist but may be empty
    // This is acceptable behavior for a layout component
  });

  it('should handle text children correctly', () => {
    const { container } = render(
      <StructureLayout>
        Simple structure text content
      </StructureLayout>
    );
    
    // Should render text content
    expect(screen.getByText('Simple structure text content')).toBeInTheDocument();
  });

  it('should maintain complex structure component structure without modification', () => {
    const complexStructureComponent = (
      <div data-testid="structure-container">
        <header data-testid="structure-header">
          <h1 data-testid="structure-title">Structure Title</h1>
          <div data-testid="structure-meta">Structure Meta Information</div>
        </header>
        <main data-testid="structure-main">
          <section data-testid="structure-intro">Introduction Section</section>
          <section data-testid="structure-main-content">Main Content Section</section>
          <section data-testid="structure-conclusion">Conclusion Section</section>
        </main>
        <aside data-testid="structure-sidebar">Structure Sidebar</aside>
      </div>
    );
    
    render(
      <StructureLayout>
        {complexStructureComponent}
      </StructureLayout>
    );
    
    // All parts of the complex structure component should be preserved
    expect(screen.getByTestId('structure-container')).toBeInTheDocument();
    expect(screen.getByTestId('structure-header')).toBeInTheDocument();
    expect(screen.getByTestId('structure-title')).toBeInTheDocument();
    expect(screen.getByTestId('structure-meta')).toBeInTheDocument();
    expect(screen.getByTestId('structure-main')).toBeInTheDocument();
    expect(screen.getByTestId('structure-intro')).toBeInTheDocument();
    expect(screen.getByTestId('structure-main-content')).toBeInTheDocument();
    expect(screen.getByTestId('structure-conclusion')).toBeInTheDocument();
    expect(screen.getByTestId('structure-sidebar')).toBeInTheDocument();
    
    expect(screen.getByText('Structure Title')).toBeInTheDocument();
    expect(screen.getByText('Structure Meta Information')).toBeInTheDocument();
    expect(screen.getByText('Introduction Section')).toBeInTheDocument();
    expect(screen.getByText('Main Content Section')).toBeInTheDocument();
    expect(screen.getByText('Conclusion Section')).toBeInTheDocument();
    expect(screen.getByText('Structure Sidebar')).toBeInTheDocument();
  });

  it('should not interfere with structure component props', () => {
    const structureComponent = (
      <button 
        data-testid="structure-button" 
        onClick={() => {}} 
        className="structure-btn-class"
        disabled={false}
        data-structure-id="456"
      >
        Edit Structure
      </button>
    );
    
    render(
      <StructureLayout>
        {structureComponent}
      </StructureLayout>
    );
    
    const button = screen.getByTestId('structure-button');
    
    // All props should be preserved
    expect(button).toHaveClass('structure-btn-class');
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent('Edit Structure');
    expect(button).toHaveAttribute('data-structure-id', '456');
  });

  it('should handle structure-specific components correctly', () => {
    const structureComponents = (
      <>
        <div data-testid="column-container" className="column-container">
          <div data-testid="introduction-column">Introduction</div>
          <div data-testid="main-column">Main Content</div>
          <div data-testid="conclusion-column">Conclusion</div>
        </div>
        <div data-testid="drag-drop-area" className="drag-drop-area">
          <div data-testid="draggable-item">Draggable Item</div>
        </div>
        <div data-testid="structure-tools" className="structure-tools">
          <button data-testid="ai-sort-btn">AI Sort</button>
          <button data-testid="reset-btn">Reset</button>
        </div>
      </>
    );
    
    render(
      <StructureLayout>
        {structureComponents}
      </StructureLayout>
    );
    
    // All structure-specific components should be rendered correctly
    expect(screen.getByTestId('column-container')).toBeInTheDocument();
    expect(screen.getByTestId('introduction-column')).toBeInTheDocument();
    expect(screen.getByTestId('main-column')).toBeInTheDocument();
    expect(screen.getByTestId('conclusion-column')).toBeInTheDocument();
    expect(screen.getByTestId('drag-drop-area')).toBeInTheDocument();
    expect(screen.getByTestId('draggable-item')).toBeInTheDocument();
    expect(screen.getByTestId('structure-tools')).toBeInTheDocument();
    expect(screen.getByTestId('ai-sort-btn')).toBeInTheDocument();
    expect(screen.getByTestId('reset-btn')).toBeInTheDocument();
    
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();
    expect(screen.getByText('Draggable Item')).toBeInTheDocument();
    expect(screen.getByText('AI Sort')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });
});
