import { fireEvent, render, screen } from '@testing-library/react';

import Select from '@/components/ui/Select';
import { SELECT_CHEVRON_CLASSES, SELECT_SIZE_CLASSES } from '@/utils/selectClasses';

describe('Select', () => {
  it('renders a native select that keeps its value, change handler and accessible name', () => {
    const onChange = jest.fn();
    render(
      <Select aria-label="Filter by book" value="gen" onChange={onChange}>
        <option value="">Filter by book</option>
        <option value="gen">Genesis</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Filter by book' });
    expect(select).toHaveValue('gen');
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('hides the browser arrow and draws its own, which never intercepts the click', () => {
    const { container } = render(
      <Select aria-label="Sort">
        <option value="a">A</option>
      </Select>,
    );
    const select = screen.getByRole('combobox');
    expect(select.className).toContain('appearance-none');
    const arrow = container.querySelector('svg');
    expect(arrow).not.toBeNull();
    expect(arrow).toHaveAttribute('aria-hidden', 'true');
    expect(arrow?.getAttribute('class')).toContain('pointer-events-none');
  });

  it('reserves the arrow seat on the right for each size', () => {
    (['sm', 'md'] as const).forEach((size) => {
      const { container, unmount } = render(
        <Select size={size} aria-label={`size ${size}`}>
          <option value="a">A</option>
        </Select>,
      );
      const select = screen.getByRole('combobox', { name: `size ${size}` });
      expect(select.className).toContain(SELECT_SIZE_CLASSES[size]);
      expect(container.querySelector('svg')?.getAttribute('class')).toContain(SELECT_CHEVRON_CLASSES[size]);
      unmount();
    });
  });

  it('puts width on the wrapper so a filter row can equalise its filters', () => {
    const { container } = render(
      <Select wrapperClassName="sm:w-52" aria-label="Tag">
        <option value="a">A</option>
      </Select>,
    );
    expect(container.firstElementChild?.className).toContain('sm:w-52');
    expect(screen.getByRole('combobox').className).not.toContain('sm:w-52');
  });

  it('passes disabled through to the control', () => {
    render(
      <Select disabled aria-label="Locked">
        <option value="a">A</option>
      </Select>,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
