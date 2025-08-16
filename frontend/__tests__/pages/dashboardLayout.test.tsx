import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Import the dashboard layout component
const DashboardLayout = require('../../app/(pages)/(private)/dashboard/layout').default;

describe('Dashboard Layout', () => {
  it('should render children without additional wrapper elements', () => {
    const testContent = <div data-testid="test-content">Test Dashboard Content</div>;
    
    const { container } = render(
      <DashboardLayout>
        {testContent}
      </DashboardLayout>
    );
    
    // The layout should render the children directly
    expect(screen.getByTestId('test-content')).toBeInTheDocument();
    expect(screen.getByText('Test Dashboard Content')).toBeInTheDocument();
    
    // The layout should not add any wrapper divs around children
    // It should just render the children directly
    expect(container.firstChild).toBe(screen.getByTestId('test-content'));
  });

  it('should handle multiple children correctly', () => {
    const multipleChildren = (
      <>
        <div data-testid="child-1">Child 1</div>
        <div data-testid="child-2">Child 2</div>
        <div data-testid="child-3">Child 3</div>
      </>
    );
    
    render(
      <DashboardLayout>
        {multipleChildren}
      </DashboardLayout>
    );
    
    // All children should be rendered
    expect(screen.getByTestId('child-1')).toBeInTheDocument();
    expect(screen.getByTestId('child-2')).toBeInTheDocument();
    expect(screen.getByTestId('child-3')).toBeInTheDocument();
    
    expect(screen.getByText('Child 1')).toBeInTheDocument();
    expect(screen.getByText('Child 2')).toBeInTheDocument();
    expect(screen.getByText('Child 3')).toBeInTheDocument();
  });

  it('should handle empty children gracefully', () => {
    const { container } = render(<DashboardLayout>{null}</DashboardLayout>);
    
    // When children is null, the component should render without crashing
    // but may not render any visible content
    expect(container).toBeInTheDocument();
    
    // The container should exist but may be empty
    // This is acceptable behavior for a layout component
  });

  it('should handle text children correctly', () => {
    const { container } = render(
      <DashboardLayout>
        Simple text content
      </DashboardLayout>
    );
    
    // Should render text content
    expect(screen.getByText('Simple text content')).toBeInTheDocument();
  });

  it('should maintain component structure without modification', () => {
    const complexComponent = (
      <div data-testid="complex-wrapper">
        <header data-testid="header">Header</header>
        <main data-testid="main">Main Content</main>
        <footer data-testid="footer">Footer</footer>
      </div>
    );
    
    render(
      <DashboardLayout>
        {complexComponent}
      </DashboardLayout>
    );
    
    // All parts of the complex component should be preserved
    expect(screen.getByTestId('complex-wrapper')).toBeInTheDocument();
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('main')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
    
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('should not interfere with child component props', () => {
    const testComponent = (
      <button 
        data-testid="test-button" 
        onClick={() => {}} 
        className="test-class"
        disabled={false}
      >
        Click me
      </button>
    );
    
    render(
      <DashboardLayout>
        {testComponent}
      </DashboardLayout>
    );
    
    const button = screen.getByTestId('test-button');
    
    // All props should be preserved
    expect(button).toHaveClass('test-class');
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent('Click me');
  });
});
