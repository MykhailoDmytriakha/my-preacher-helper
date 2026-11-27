import { fireEvent, render, screen, within } from '@testing-library/react';

import FormField, { FORM_INPUT_CLASS } from '@/components/ui/FormField';

it('labels native fields without taking over their validation or value', () => {
  render(<><FormField label="Title" required><input className={FORM_INPUT_CLASS} required defaultValue="Draft" /></FormField><FormField label="Description"><textarea /></FormField></>);
  expect(screen.getByRole('textbox', { name: 'Title *' })).toBeRequired();
  expect(screen.getByRole('textbox', { name: 'Title *' })).toHaveValue('Draft');
  expect(screen.getByRole('textbox', { name: 'Description' })).not.toBeRequired();
});

it('keeps text clicks from activating a toolbar button in a labelled group', () => {
  const bold = jest.fn();
  render(<FormField label="Description" group>
    <button type="button" onClick={bold}>Bold</button>
    <div contentEditable suppressContentEditableWarning><p>Opening paragraph</p></div>
  </FormField>);
  fireEvent.click(screen.getByText('Opening paragraph'));
  expect(bold).not.toHaveBeenCalled();
  const toolbar = within(screen.getByRole('group', { name: 'Description' })).getByRole('button', { name: 'Bold' });
  fireEvent.click(toolbar);
  expect(bold).toHaveBeenCalledTimes(1);
});
