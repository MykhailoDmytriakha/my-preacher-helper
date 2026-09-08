import { fireEvent, render, screen } from '@testing-library/react';

import SeriesFormFields, { seriesFormPatch, seriesFormValues } from '@/components/series/SeriesFormFields';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: () => <div /> }));

it('initializes a new form and emits only editable normalized fields', () => {
  const values = seriesFormValues();
  expect(values).toEqual({ title: '', description: '', bookOrTopic: '', color: '#3B82F6', status: 'draft' });
  expect(seriesFormPatch({ ...values, title: ' Title ', description: '  ', bookOrTopic: ' Romans ', color: '' })).toEqual({
    title: 'Title', theme: 'Title', description: undefined, bookOrTopic: 'Romans', color: undefined, status: 'draft',
  });
});

it('exposes controlled color selection without changing fields until the owner accepts the patch', () => {
  const onChange = jest.fn();
  const values = seriesFormValues();
  const { rerender } = render(<SeriesFormFields values={values} onChange={onChange} colorPickerTitle="Series" />);
  const green = screen.getByRole('button', { name: '#10B981' });
  fireEvent.click(green);
  expect(onChange).toHaveBeenCalledWith({ color: '#10B981' });
  expect(green).toHaveAttribute('aria-pressed', 'false');
  rerender(<SeriesFormFields values={{ ...values, color: '#10B981' }} onChange={onChange} colorPickerTitle="Series" />);
  expect(green).toHaveAttribute('aria-pressed', 'true');
});
