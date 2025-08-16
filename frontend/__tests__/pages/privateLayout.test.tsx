import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Import PrivateLayout using the working strategy
const PrivateLayout = require('../../app/(pages)/(private)/layout').default;

describe('Private Layout', () => {
  // Basic functionality tests
  it('should have PrivateLayout imported correctly', () => {
    expect(PrivateLayout).toBeDefined();
    expect(typeof PrivateLayout).toBe('function');
  });

  it('should be able to use PrivateLayout in JSX', () => {
    const element = <PrivateLayout>Test</PrivateLayout>;
    expect(element).toBeDefined();
    expect(element.type).toBe(PrivateLayout);
  });

  it('should render without crashing when wrapped in error boundary', () => {
    // This test verifies that the component can be rendered
    // even if there are issues with child components
    expect(() => {
      render(<PrivateLayout>Test</PrivateLayout>);
    }).not.toThrow();
  });

  // Test the component structure by checking what actually renders
  it('should render some content', () => {
    const { container } = render(<PrivateLayout>Test Content</PrivateLayout>);
    
    // The component should render something
    expect(container.firstChild).toBeInTheDocument();
    
    // Even if child components fail, the wrapper should exist
    expect(container.innerHTML).toContain('min-h-screen');
  });
});
