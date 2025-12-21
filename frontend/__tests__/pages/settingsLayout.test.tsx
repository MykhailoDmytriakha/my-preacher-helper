import { render, screen } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';
import SettingsSectionLayout from '../../app/(pages)/(private)/settings/layout';

describe('Settings Section Layout', () => {
  it('should render children without additional wrapper elements', () => {
    const testContent = <div data-testid="test-content">Test Settings Content</div>;
    
    const { container } = render(
      <SettingsSectionLayout>
        {testContent}
      </SettingsSectionLayout>
    );
    
    // The layout should render the children directly
    expect(screen.getByTestId('test-content')).toBeInTheDocument();
    expect(screen.getByText('Test Settings Content')).toBeInTheDocument();
    
    // The layout should not add any wrapper divs around children
    // It should just render the children directly
    expect(container.firstChild).toBe(screen.getByTestId('test-content'));
  });

  it('should handle multiple children correctly', () => {
    const multipleChildren = (
      <>
        <div data-testid="settings-header">Settings Header</div>
        <div data-testid="settings-content">Settings Content</div>
        <div data-testid="settings-footer">Settings Footer</div>
      </>
    );
    
    render(
      <SettingsSectionLayout>
        {multipleChildren}
      </SettingsSectionLayout>
    );
    
    // All children should be rendered
    expect(screen.getByTestId('settings-header')).toBeInTheDocument();
    expect(screen.getByTestId('settings-content')).toBeInTheDocument();
    expect(screen.getByTestId('settings-footer')).toBeInTheDocument();
    
    expect(screen.getByText('Settings Header')).toBeInTheDocument();
    expect(screen.getByText('Settings Content')).toBeInTheDocument();
    expect(screen.getByText('Settings Footer')).toBeInTheDocument();
  });

  it('should handle empty children gracefully', () => {
    const { container } = render(<SettingsSectionLayout>{null}</SettingsSectionLayout>);
    
    // When children is null, the component should render without crashing
    // but may not render any visible content
    expect(container).toBeInTheDocument();
    
    // The container should exist but may be empty
    // This is acceptable behavior for a layout component
  });

  it('should handle text children correctly', () => {
    render(
      <SettingsSectionLayout>
        Simple settings text content
      </SettingsSectionLayout>
    );
    
    // Should render text content
    expect(screen.getByText('Simple settings text content')).toBeInTheDocument();
  });

  it('should maintain component structure without modification', () => {
    const complexComponent = (
      <div data-testid="settings-container">
        <header data-testid="settings-header">Settings Header</header>
        <main data-testid="settings-main">Settings Main Content</main>
        <footer data-testid="settings-footer">Settings Footer</footer>
      </div>
    );
    
    render(
      <SettingsSectionLayout>
        {complexComponent}
      </SettingsSectionLayout>
    );
    
    // All parts of the complex component should be preserved
    expect(screen.getByTestId('settings-container')).toBeInTheDocument();
    expect(screen.getByTestId('settings-header')).toBeInTheDocument();
    expect(screen.getByTestId('settings-main')).toBeInTheDocument();
    expect(screen.getByTestId('settings-footer')).toBeInTheDocument();
    
    expect(screen.getByText('Settings Header')).toBeInTheDocument();
    expect(screen.getByText('Settings Main Content')).toBeInTheDocument();
    expect(screen.getByText('Settings Footer')).toBeInTheDocument();
  });

  it('should not interfere with child component props', () => {
    const testComponent = (
      <button 
        data-testid="settings-button" 
        onClick={() => {}} 
        className="settings-btn-class"
        disabled={false}
        data-settings-id="123"
      >
        Save Settings
      </button>
    );
    
    render(
      <SettingsSectionLayout>
        {testComponent}
      </SettingsSectionLayout>
    );
    
    const button = screen.getByTestId('settings-button');
    
    // All props should be preserved
    expect(button).toHaveClass('settings-btn-class');
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('Save Settings');
    expect(button).toHaveAttribute('data-settings-id', '123');
  });
});
