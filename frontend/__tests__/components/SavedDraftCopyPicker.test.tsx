import { fireEvent, render, screen } from '@testing-library/react';

import SavedDraftCopyPicker from '@/components/SavedDraftCopyPicker';

jest.mock('@locales/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const options = [
  { key: 'physical-a', label: 'Same preview' },
  { key: 'physical-b', label: 'Same preview' },
];

describe('SavedDraftCopyPicker', () => {
  it('is absent with fewer than two choices', () => {
    const { container, rerender } = render(
      <SavedDraftCopyPicker options={[]} selectedKey={null} onChange={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<SavedDraftCopyPicker options={[options[0]]} selectedKey={null} onChange={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('selects and reports physical keys even when option labels match', () => {
    const onChange = jest.fn();
    render(<SavedDraftCopyPicker options={options} selectedKey="physical-b" onChange={onChange} />);

    const select = screen.getByLabelText('unsavedDraft.chooseCopy');
    expect(select).toHaveValue('physical-b');
    expect(screen.getByRole('option', { name: '1. Same preview' })).toHaveValue('physical-a');
    expect(screen.getByRole('option', { name: '2. Same preview' })).toHaveValue('physical-b');

    fireEvent.change(select, { target: { value: 'physical-a' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('physical-a');
  });

  it('passes disabled to the native select', () => {
    render(<SavedDraftCopyPicker options={options} selectedKey="physical-a" onChange={jest.fn()} disabled />);

    expect(screen.getByLabelText('unsavedDraft.chooseCopy')).toBeDisabled();
  });

  it('ignores a change to a key outside the available options', () => {
    const onChange = jest.fn();
    render(<SavedDraftCopyPicker options={options} selectedKey="physical-a" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('unsavedDraft.chooseCopy'), { target: { value: 'foreign-key' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('limits long option labels to 120 characters', () => {
    const label = 'x'.repeat(130);
    render(<SavedDraftCopyPicker options={[{ key: 'a', label }, options[1]]} selectedKey="a" onChange={jest.fn()} />);

    expect(screen.getByRole('option', { name: `1. ${'x'.repeat(119)}…` })).toBeInTheDocument();
    expect(label).toHaveLength(130);
  });
});
