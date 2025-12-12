import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// Import the sermon detail layout component
const SermonAreaLayout = require('../../app/(pages)/(private)/sermons/[id]/layout').default;

describe('Sermon Detail Layout', () => {
  it('should render children without additional wrapper elements', () => {
    const testContent = <div data-testid="test-content">Test Sermon Content</div>;
    
    const { container } = render(
      <SermonAreaLayout>
        {testContent}
      </SermonAreaLayout>
    );
    
    // The layout should render the children directly
    expect(screen.getByTestId('test-content')).toBeInTheDocument();
    expect(screen.getByText('Test Sermon Content')).toBeInTheDocument();
    
    // The layout should not add any wrapper divs around children
    // It should just render the children directly
    expect(container.firstChild).toBe(screen.getByTestId('test-content'));
  });

  it('should handle multiple children correctly', () => {
    const multipleChildren = (
      <>
        <div data-testid="sermon-header">Sermon Header</div>
        <div data-testid="sermon-content">Sermon Content</div>
        <div data-testid="sermon-footer">Sermon Footer</div>
      </>
    );
    
    render(
      <SermonAreaLayout>
        {multipleChildren}
      </SermonAreaLayout>
    );
    
    // All children should be rendered
    expect(screen.getByTestId('sermon-header')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-content')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-footer')).toBeInTheDocument();
    
    expect(screen.getByText('Sermon Header')).toBeInTheDocument();
    expect(screen.getByText('Sermon Content')).toBeInTheDocument();
    expect(screen.getByText('Sermon Footer')).toBeInTheDocument();
  });

  it('should handle empty children gracefully', () => {
    const { container } = render(<SermonAreaLayout>{null}</SermonAreaLayout>);
    
    // When children is null, the component should render without crashing
    // but may not render any visible content
    expect(container).toBeInTheDocument();
    
    // The container should exist but may be empty
    // This is acceptable behavior for a layout component
  });

  it('should handle text children correctly', () => {
    render(
      <SermonAreaLayout>
        Simple sermon text content
      </SermonAreaLayout>
    );
    
    // Should render text content
    expect(screen.getByText('Simple sermon text content')).toBeInTheDocument();
  });

  it('should maintain complex sermon component structure without modification', () => {
    const complexSermonComponent = (
      <div data-testid="sermon-container">
        <header data-testid="sermon-header">
          <h1 data-testid="sermon-title">Sermon Title</h1>
          <div data-testid="sermon-meta">Sermon Meta Information</div>
        </header>
        <main data-testid="sermon-main">
          <section data-testid="sermon-outline">Sermon SermonOutline</section>
          <section data-testid="sermon-notes">Sermon Notes</section>
        </main>
        <aside data-testid="sermon-sidebar">Sermon Sidebar</aside>
      </div>
    );
    
    render(
      <SermonAreaLayout>
        {complexSermonComponent}
      </SermonAreaLayout>
    );
    
    // All parts of the complex sermon component should be preserved
    expect(screen.getByTestId('sermon-container')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-header')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-title')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-meta')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-main')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-outline')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-notes')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-sidebar')).toBeInTheDocument();
    
    expect(screen.getByText('Sermon Title')).toBeInTheDocument();
    expect(screen.getByText('Sermon Meta Information')).toBeInTheDocument();
    expect(screen.getByText('Sermon SermonOutline')).toBeInTheDocument();
    expect(screen.getByText('Sermon Notes')).toBeInTheDocument();
    expect(screen.getByText('Sermon Sidebar')).toBeInTheDocument();
  });

  it('should not interfere with sermon component props', () => {
    const sermonComponent = (
      <button 
        data-testid="sermon-button" 
        onClick={() => {}} 
        className="sermon-btn-class"
        disabled={false}
        data-sermon-id="123"
      >
        Edit Sermon
      </button>
    );
    
    render(
      <SermonAreaLayout>
        {sermonComponent}
      </SermonAreaLayout>
    );
    
    const button = screen.getByTestId('sermon-button');
    
    // All props should be preserved
    expect(button).toHaveClass('sermon-btn-class');
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('Edit Sermon');
    expect(button).toHaveAttribute('data-sermon-id', '123');
  });

  it('should handle sermon-specific components correctly', () => {
    const sermonComponents = (
      <>
        <div data-testid="mode-toggle" className="mode-toggle">
          <button data-testid="classic-mode">Classic</button>
          <button data-testid="prep-mode">Prep</button>
        </div>
        <div data-testid="sermon-outline" className="sermon-outline">
          <h2>SermonOutline</h2>
          <ul>
            <li>Introduction</li>
            <li>Main Points</li>
            <li>Conclusion</li>
          </ul>
        </div>
        <div data-testid="brainstorm-module" className="brainstorm-module">
          <h3>Brainstorm</h3>
          <textarea data-testid="brainstorm-input" placeholder="Enter your thoughts..."></textarea>
        </div>
      </>
    );
    
    render(
      <SermonAreaLayout>
        {sermonComponents}
      </SermonAreaLayout>
    );
    
    // All sermon-specific components should be rendered correctly
    expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('classic-mode')).toBeInTheDocument();
    expect(screen.getByTestId('prep-mode')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-outline')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-module')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-input')).toBeInTheDocument();
    
    expect(screen.getByText('Classic')).toBeInTheDocument();
    expect(screen.getByText('Prep')).toBeInTheDocument();
    expect(screen.getByText('SermonOutline')).toBeInTheDocument();
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Main Points')).toBeInTheDocument();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();
    expect(screen.getByText('Brainstorm')).toBeInTheDocument();
    expect(screen.getByDisplayValue('')).toBeInTheDocument(); // Empty textarea
  });

  it('should preserve sermon component event handlers', () => {
    const mockClickHandler = jest.fn();
    const mockChangeHandler = jest.fn();
    
    const sermonComponent = (
      <div data-testid="sermon-interactive">
        <button data-testid="sermon-action-btn" onClick={mockClickHandler}>
          Perform Action
        </button>
        <input 
          data-testid="sermon-input" 
          type="text" 
          onChange={mockChangeHandler}
          placeholder="Enter sermon text"
        />
      </div>
    );
    
    render(
      <SermonAreaLayout>
        {sermonComponent}
      </SermonAreaLayout>
    );
    
    const button = screen.getByTestId('sermon-action-btn');
    const input = screen.getByTestId('sermon-input');
    
    // Event handlers should be preserved and functional
    button.click();
    expect(mockClickHandler).toHaveBeenCalledTimes(1);
    
    // Simulate input change
    fireEvent.change(input, { target: { value: 'New sermon text' } });
    expect(mockChangeHandler).toHaveBeenCalledTimes(1);
  });

  it('should handle conditional rendering of sermon components', () => {
    const conditionalSermonContent = (
      <>
        <div data-testid="always-visible">Always Visible Content</div>
        {true && <div data-testid="conditionally-visible">Conditionally Visible</div>}
        {false && <div data-testid="never-visible">Never Visible</div>}
      </>
    );
    
    render(
      <SermonAreaLayout>
        {conditionalSermonContent}
      </SermonAreaLayout>
    );
    
    // Should render always visible content
    expect(screen.getByTestId('always-visible')).toBeInTheDocument();
    expect(screen.getByText('Always Visible Content')).toBeInTheDocument();
    
    // Should render conditionally visible content
    expect(screen.getByTestId('conditionally-visible')).toBeInTheDocument();
    expect(screen.getByText('Conditionally Visible')).toBeInTheDocument();
    
    // Should not render never visible content
    expect(screen.queryByTestId('never-visible')).not.toBeInTheDocument();
    expect(screen.queryByText('Never Visible')).not.toBeInTheDocument();
  });
});
