import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AddTagForm from '@components/settings/AddTagForm';

// --- Mocks --- //

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Mock ColorPickerModal - Revised Mock Logic
const actualColorPickerModal = jest.requireActual('@components/ColorPickerModal');
const mockOnOkInternal = jest.fn();
const mockOnCancelInternal = jest.fn();

jest.mock('@components/ColorPickerModal', () => (props: any) => {
    // Capture the functions passed by the parent
    mockOnOkInternal.mockImplementation(props.onOk);
    mockOnCancelInternal.mockImplementation(props.onCancel);
    // The modal's visibility is controlled by the parent component's conditional rendering.
    // This mock just needs to render its structure when it's included.
    return (
      <div data-testid="color-picker-modal">
        Mock Color Picker for: {props.tagName} - Initial: {props.initialColor}
        <button onClick={() => mockOnOkInternal('#ABCDEF')}>Select #ABCDEF</button>
        <button onClick={mockOnCancelInternal}>Cancel Picker</button>
      </div>
    );
});

// --- Test Suite --- //

describe('AddTagForm', () => {
  const mockOnAddTag = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // No need for renderMockModal flag anymore
    mockOnOkInternal.mockClear();
    mockOnCancelInternal.mockClear();
  });

  const renderForm = () => {
    return render(<AddTagForm onAddTag={mockOnAddTag} />);
  };

  it('renders initial state correctly', () => {
    renderForm();
    expect(screen.getByLabelText(/settings.tagName/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settings.selectColor/i })).toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: /settings.addTag/i });
    expect(addButton).toBeInTheDocument();
    expect(addButton).toBeDisabled(); // Initially disabled
  });

  it('enables add button when tag name is entered', async () => {
    renderForm();
    const tagNameInput = screen.getByLabelText(/settings.tagName/i);
    const addButton = screen.getByRole('button', { name: /settings.addTag/i });

    expect(addButton).toBeDisabled();
    await userEvent.type(tagNameInput, 'New Tag Name');
    expect(addButton).toBeEnabled();
  });

  it('calls onAddTag with name and default color on submit', async () => {
    renderForm();
    const tagNameInput = screen.getByLabelText(/settings.tagName/i);
    const colorButton = screen.getByRole('button', { name: /settings.selectColor/i });
    // Use data-testid to find the form
    const formElement = screen.getByTestId('add-tag-form-element'); 

    const initialColor = colorButton.style.backgroundColor;
    expect(initialColor).toBeTruthy();

    await userEvent.type(tagNameInput, 'My First Tag');
    // Submit using the found form element
    await fireEvent.submit(formElement); 

    expect(mockOnAddTag).toHaveBeenCalledTimes(1);
    expect(mockOnAddTag).toHaveBeenCalledWith('My First Tag', expect.stringMatching(/^#[0-9A-F]{6}$/i)); 

    expect(tagNameInput).toHaveValue('');
    expect(screen.getByRole('button', { name: /settings.addTag/i })).toBeDisabled();
  });

   it('opens color picker modal when color button is clicked', async () => {
     renderForm();
     const colorButton = screen.getByRole('button', { name: /settings.selectColor/i });
     
     expect(screen.queryByTestId('color-picker-modal')).not.toBeInTheDocument();

     // Click the button that triggers setIsColorPickerOpen(true) in the component
     await userEvent.click(colorButton);
     
     // No need to manually control mock visibility or rerender.
     // The component's state change should cause the modal to render.

     expect(await screen.findByTestId('color-picker-modal')).toBeInTheDocument();
     expect(screen.getByText(/Mock Color Picker for:/i)).toBeInTheDocument();
   });

   it('updates color preview when color is selected in modal', async () => {
     renderForm();
     const colorButton = screen.getByRole('button', { name: /settings.selectColor/i });
     
     // 1. Open the modal by clicking the button
     await userEvent.click(colorButton);
     expect(await screen.findByTestId('color-picker-modal')).toBeInTheDocument();

     // 2. Click the select button in the mock modal
     const selectColorButton = screen.getByRole('button', { name: /Select #ABCDEF/i });
     await userEvent.click(selectColorButton);

     // 3. Check the effect: The component's internal state should update the color button
     //    and the modal should close (handled by onOk -> setIsColorPickerOpen(false))
     await waitFor(() => {
       // Check the button style reflects the selected color
       expect(colorButton).toHaveStyle('background-color: #ABCDEF');
     });
     // The mock modal should disappear because the component called onOk, which sets isColorPickerOpen=false
     await waitFor(() => {
       expect(screen.queryByTestId('color-picker-modal')).not.toBeInTheDocument();
     });

     // 4. Verify submitting the form now uses the new color
     const tagNameInput = screen.getByLabelText(/settings.tagName/i);
     const formElement = screen.getByTestId('add-tag-form-element');
     await userEvent.type(tagNameInput, 'Colored Tag');
     await fireEvent.submit(formElement);
     
     expect(mockOnAddTag).toHaveBeenCalledWith('Colored Tag', '#ABCDEF');
   });

   it('closes color picker modal on cancel', async () => {
     renderForm();
     const colorButton = screen.getByRole('button', { name: /settings.selectColor/i });

     // 1. Open the modal by clicking the button
     await userEvent.click(colorButton);
     expect(await screen.findByTestId('color-picker-modal')).toBeInTheDocument();

     // 2. Click cancel in the mock
     const cancelButton = screen.getByRole('button', { name: /Cancel Picker/i });
     await userEvent.click(cancelButton);

     // 3. Modal should close because the component called onCancel, setting isColorPickerOpen=false
     await waitFor(() => {
       expect(screen.queryByTestId('color-picker-modal')).not.toBeInTheDocument();
     });
   });
}); 