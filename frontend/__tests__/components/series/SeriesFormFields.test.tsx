import { fireEvent, render, screen } from '@testing-library/react';

import SeriesFormFields, { seriesFormPatch, seriesFormValues } from '@/components/series/SeriesFormFields';
import { SERIES_COLOR_PRESETS } from '@/utils/themeColors';

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

// Moved from the legacy series modal contract when those modals left with the legacy road: the
// engine create and edit dialogs draw these same fields.
jest.mock('@/components/ColorPickerModal', () => ({
  __esModule: true,
  default: ({ initialColor, onOk, onCancel }: { initialColor: string; onOk: (value: string) => void; onCancel: () => void }) =>
    <div data-testid="color-picker"><span>{initialColor}</span><button type="button" onClick={() => onOk('#123456')}>Choose custom</button><button type="button" onClick={onCancel}>Cancel custom</button></div>,
}));

it('offers the eight preset colours and a custom picker that opens on the current colour', () => {
  render(<SeriesFormFields values={{ ...seriesFormValues(), color: '#10B981' }} onChange={jest.fn()} colorPickerTitle="Series" />);
  expect(SERIES_COLOR_PRESETS).toHaveLength(8);
  for (const color of SERIES_COLOR_PRESETS) expect(screen.getByRole('button', { name: color })).toBeInTheDocument();
  fireEvent.click(screen.getByTitle('workspaces.series.form.customColor'));
  expect(screen.getByTestId('color-picker')).toHaveTextContent('#10B981');
});

it('takes a custom colour only on confirmation and changes nothing when the picker is cancelled', () => {
  const onChange = jest.fn();
  render(<SeriesFormFields values={seriesFormValues()} onChange={onChange} colorPickerTitle="Series" />);
  fireEvent.click(screen.getByTitle('workspaces.series.form.customColor'));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel custom' }));
  expect(screen.queryByTestId('color-picker')).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('workspaces.series.form.customColor'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose custom' }));
  expect(onChange).toHaveBeenCalledWith({ color: '#123456' });
  expect(screen.queryByTestId('color-picker')).not.toBeInTheDocument();
});
