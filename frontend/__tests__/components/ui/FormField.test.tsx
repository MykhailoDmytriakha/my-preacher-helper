import { render, screen } from '@testing-library/react';

import FormField, { FORM_INPUT_CLASS } from '@/components/ui/FormField';

it('labels native fields without taking over their validation or value', () => {
  render(<><FormField label="Title" required><input className={FORM_INPUT_CLASS} required defaultValue="Draft" /></FormField><FormField label="Description"><textarea /></FormField></>);
  expect(screen.getByRole('textbox', { name: 'Title *' })).toBeRequired();
  expect(screen.getByRole('textbox', { name: 'Title *' })).toHaveValue('Draft');
  expect(screen.getByRole('textbox', { name: 'Description' })).not.toBeRequired();
});
