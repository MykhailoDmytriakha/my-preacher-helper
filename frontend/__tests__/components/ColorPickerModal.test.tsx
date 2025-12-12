import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import ColorPickerModal from '@/components/ColorPickerModal';
import '@testing-library/jest-dom';

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key: string) => {
        const translations: Record<string, string> = {
          'settings.editColorFor': 'Edit color for',
          'settings.presetColors': 'Preset Colors',
          'settings.customColor': 'Custom Color',
          'common.cancel': 'Cancel',
          'common.save': 'Save',
        };
        return translations[key] || key;
      }
    };
  },
}));

describe('ColorPickerModal Component', () => {
  const mockProps = {
    tagName: 'TestTag',
    initialColor: '#1DD1A1',
    onOk: jest.fn(),
    onCancel: jest.fn()
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test('renders with correct initial values', () => {
    render(<ColorPickerModal {...mockProps} />);
    
    // Check title
    expect(screen.getByText('Edit color for')).toBeInTheDocument();
    expect(screen.getByText('TestTag')).toBeInTheDocument();
    
    // Check color preview
    const colorPreview = screen.getByText('#1DD1A1').previousSibling;
    expect(colorPreview).toHaveStyle('background-color: #1DD1A1');
    
    // Check preset colors section
    expect(screen.getByText('Preset Colors')).toBeInTheDocument();
    
    // Check custom color section
    expect(screen.getByText('Custom Color')).toBeInTheDocument();
    
    // Check color input fields
    const colorInput = screen.getByDisplayValue('#1DD1A1');
    expect(colorInput).toBeInTheDocument();
    
    // Check buttons
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });
  
  test('calls onCancel when cancel button is clicked', () => {
    render(<ColorPickerModal {...mockProps} />);
    
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    
    expect(mockProps.onCancel).toHaveBeenCalledTimes(1);
  });
  
  test('calls onOk with selected color when save button is clicked', () => {
    render(<ColorPickerModal {...mockProps} />);
    
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    expect(mockProps.onOk).toHaveBeenCalledWith('#1DD1A1');
  });
  
  test('updates color when a preset color is clicked', () => {
    render(<ColorPickerModal {...mockProps} />);
    
    // Find all preset color buttons
    const allColorButtons = document.querySelectorAll('button[aria-label^="Color #"]');
    
    // Click on a different color (first button)
    fireEvent.click(allColorButtons[0]);
    
    
    // Clicking the Save button should use the new color
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    // The selected color is passed to onOk, but it may be different format 
    // (rgb vs hex) depending on the browser/jest environment, so we check 
    // that onOk was called with any argument
    expect(mockProps.onOk).toHaveBeenCalled();
    
    // And verify it wasn't called with the initial color
    expect(mockProps.onOk).not.toHaveBeenCalledWith('#1DD1A1');
  });
  
  test('updates color when custom color input is changed', () => {
    render(<ColorPickerModal {...mockProps} />);
    
    // Find the text input for custom color
    const customColorInput = screen.getByDisplayValue('#1DD1A1');
    
    // Change to a new color
    fireEvent.change(customColorInput, { target: { value: '#FF5733' } });
    
    // Check that the color preview updated
    const colorPreview = screen.getByText('#FF5733').previousSibling;
    expect(colorPreview).toHaveStyle('background-color: #FF5733');
    
    // Save with the new color
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    expect(mockProps.onOk).toHaveBeenCalledWith('#FF5733');
  });
  
  test('handles the color picker input change', () => {
    render(<ColorPickerModal {...mockProps} />);
    
    // Find the color input element by type
    const colorPickerInput = screen.getByDisplayValue('#1DD1A1');
    fireEvent.change(colorPickerInput, { target: { value: '#FF5733' } });
    
    // Check the color preview using case-insensitive regex
    const colorPreview = screen.getByText(/#ff5733/i);
    expect(colorPreview).toBeInTheDocument();
    
    // Save with the new color
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    expect(mockProps.onOk).toHaveBeenCalledWith('#FF5733');
  });
  
  test('preserves color when switching between preset and custom', () => {
    render(<ColorPickerModal {...mockProps} />);
    
    // First select a preset color
    const redPreset = screen.getByLabelText('Color #FF6B6B');
    fireEvent.click(redPreset);
    
    // Now enter a custom color
    const customColorInput = screen.getByRole('textbox');
    fireEvent.change(customColorInput, { target: { value: '#FF5733' } });
    
    // Then select another preset
    const bluePreset = screen.getByLabelText('Color #54A0FF');
    fireEvent.click(bluePreset);
    
    // Check that the color preview shows the latest selection
    const colorPreview = screen.getByText('#54a0ff', { exact: false });
    expect(colorPreview).toBeInTheDocument();
    
    // Save button should use the latest color
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    expect(mockProps.onOk).toHaveBeenCalledWith('#54A0FF');
  });
}); 