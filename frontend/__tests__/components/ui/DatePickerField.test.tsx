import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import DatePickerField from '@/components/ui/DatePickerField';

import '@testing-library/jest-dom';

const mockDayPicker = jest.fn();
const mockUseUserSettings = jest.fn();

jest.mock('react-day-picker', () => ({
  DayPicker: (props: any) => {
    mockDayPicker(props);
    return (
      <button
        type="button"
        data-testid="select-date"
        onClick={() => props.onSelect(new Date(2026, 1, 16))}
      >
        Select date
      </button>
    );
  },
}));

jest.mock('react-day-picker/dist/style.css', () => ({}));

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
}));

jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: (...args: any[]) => mockUseUserSettings(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
    i18n: { language: 'en' },
  }),
}));

describe('DatePickerField', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUserSettings.mockReturnValue({ settings: { firstDayOfWeek: 'sunday' } });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    });
  });

  it('uses a text input instead of a native date input', () => {
    render(<DatePickerField id="date" value="" onChange={jest.fn()} />);

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).not.toHaveAttribute('type', 'date');
  });

  it('passes Monday preference to react-day-picker', () => {
    mockUseUserSettings.mockReturnValue({ settings: { firstDayOfWeek: 'monday' } });

    render(<DatePickerField id="date" value="" onChange={jest.fn()} />);

    fireEvent.click(screen.getByLabelText('Open calendar'));

    expect(mockDayPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        weekStartsOn: 1,
      })
    );
  });

  it('defaults react-day-picker to Sunday when no preference is saved', () => {
    mockUseUserSettings.mockReturnValue({ settings: {} });

    render(<DatePickerField id="date" value="" onChange={jest.fn()} />);

    fireEvent.click(screen.getByLabelText('Open calendar'));

    expect(mockDayPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        weekStartsOn: 0,
      })
    );
  });

  it('writes selected dates as yyyy-MM-dd values', () => {
    const onChange = jest.fn();

    render(<DatePickerField id="date" value="" onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Open calendar'));
    fireEvent.click(screen.getByTestId('select-date'));

    expect(onChange).toHaveBeenCalledWith('2026-02-16');
  });

  it('uses react-day-picker v9 selected-day selectors with a filled dark-mode style', () => {
    render(<DatePickerField id="date" value="2026-05-10" onChange={jest.fn()} />);

    fireEvent.click(screen.getByLabelText('Open calendar'));

    const popover = screen.getByTestId('date-calendar-popover');
    const calendarStyles = popover.querySelector('style')?.textContent;

    expect(calendarStyles).toContain('.date-picker-field-calendar .rdp-selected .rdp-day_button');
    expect(calendarStyles).toContain('--date-picker-selected-background: #2563eb');
    expect(calendarStyles).toContain('--date-picker-selected-border: #93c5fd');
    expect(calendarStyles).toContain('box-shadow: 0 0 0 2px var(--date-picker-selected-shadow)');
  });

  // A form keeps every keystroke: its `pattern` refuses a half-typed date at submit, and a draft
  // keeps what was typed.
  it('hands every keystroke to a form by default', () => {
    const onChange = jest.fn();
    render(<DatePickerField id="date" value="" onChange={onChange} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2026-0' } });

    expect(onChange).toHaveBeenCalledWith('2026-0');
  });

  // The browser's date field refused a day that does not exist; the text field's pattern checks
  // only the shape, so a creating form asks the field to refuse it.
  it('makes a creating form refuse a day the calendar does not have', () => {
    function Form() {
      const [value, setValue] = React.useState('2026-02-20');
      return <DatePickerField id="date" refuseMissingDays value={value} onChange={setValue} />;
    }
    render(<Form />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '2026-02-31' } });
    expect(input.checkValidity()).toBe(false);
    expect(input.validationMessage).toBe('There is no such day in the calendar');

    fireEvent.change(input, { target: { value: '2026-02-28' } });
    expect(input.checkValidity()).toBe(true);
  });

  // An editing form keeps HEAD's behaviour: a record saved with such a day, or a recovered draft
  // holding one, must still save its other fields.
  it('does not refuse any day unless the form asks for it', () => {
    function Form() {
      const [value, setValue] = React.useState('2026-02-31');
      return <DatePickerField id="date" value={value} onChange={setValue} />;
    }
    render(<Form />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.checkValidity()).toBe(true);

    fireEvent.change(input, { target: { value: '2026-04-31' } });
    expect(input.checkValidity()).toBe(true);
  });

  // A caller that saves on every change (a council's date, a group's meeting) hears only a
  // finished day or an emptied field — never the keystrokes in between.
  describe('finishedDatesOnly', () => {
    function Saving({ initial = '2026-09-20', accept = true, onSave = jest.fn() }: { initial?: string; accept?: boolean; onSave?: jest.Mock }) {
      const [value, setValue] = React.useState(initial);
      return (
        <DatePickerField
          id="date"
          finishedDatesOnly
          value={value}
          onChange={(next) => {
            onSave(next);
            if (accept) setValue(next);
          }}
        />
      );
    }

    it('keeps a half-typed date in the field without handing it over', () => {
      const onSave = jest.fn();
      render(<Saving onSave={onSave} />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: '2' } });
      fireEvent.change(input, { target: { value: '2026-0' } });
      fireEvent.change(input, { target: { value: '2026-09-2' } });

      expect(onSave).not.toHaveBeenCalled();
      expect(input).toHaveValue('2026-09-2');
    });

    it('hands over a finished day once it is typed', () => {
      const onSave = jest.fn();
      render(<Saving onSave={onSave} />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: '2026-09-21' } });
      fireEvent.blur(input);

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith('2026-09-21');
      expect(input).toHaveValue('2026-09-21');
    });

    it('hands over a pasted day without the space around it', () => {
      const onSave = jest.fn();
      render(<Saving onSave={onSave} />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: ' 2026-09-21 ' } });
      fireEvent.blur(input);

      expect(onSave).toHaveBeenCalledWith('2026-09-21');
      expect(input).toHaveValue('2026-09-21');
    });

    it('does not hand over a day the calendar does not have', () => {
      const onSave = jest.fn();
      render(<Saving initial="2026-02-20" onSave={onSave} />);

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '2026-02-31' } });

      expect(onSave).not.toHaveBeenCalled();
    });

    it('hands over an emptied field at once', () => {
      const onSave = jest.fn();
      render(<Saving onSave={onSave} />);

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });

      expect(onSave).toHaveBeenCalledWith('');
    });

    it('shows the saved day again when the person leaves a half-typed one', () => {
      const onSave = jest.fn();
      render(<Saving onSave={onSave} />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: '2026-1' } });
      fireEvent.blur(input);

      expect(input).toHaveValue('2026-09-20');
      expect(onSave).not.toHaveBeenCalled();
    });

    it('keeps the text being typed when a new day arrives from elsewhere, and shows it on leaving', () => {
      const { rerender } = render(<DatePickerField id="date" finishedDatesOnly value="2026-09-20" onChange={jest.fn()} />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: '2026-10-' } });
      rerender(<DatePickerField id="date" finishedDatesOnly value="2026-09-22" onChange={jest.fn()} />);
      expect(input).toHaveValue('2026-10-');

      fireEvent.blur(input);
      expect(input).toHaveValue('2026-09-22');
    });

    it('follows a day from elsewhere after a pasted day was taken', () => {
      const { rerender } = render(<DatePickerField id="date" finishedDatesOnly value="2026-09-20" onChange={jest.fn()} />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: ' 2026-09-21 ' } });
      rerender(<DatePickerField id="date" finishedDatesOnly value="2026-09-21" onChange={jest.fn()} />);
      rerender(<DatePickerField id="date" finishedDatesOnly value="2026-09-23" onChange={jest.fn()} />);

      expect(input).toHaveValue('2026-09-23');
    });

    it('follows a day from elsewhere after the field was cleared with spaces', () => {
      const { rerender } = render(<DatePickerField id="date" finishedDatesOnly value="2026-09-20" onChange={jest.fn()} />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: '  ' } });
      rerender(<DatePickerField id="date" finishedDatesOnly value="" onChange={jest.fn()} />);
      rerender(<DatePickerField id="date" finishedDatesOnly value="2026-09-23" onChange={jest.fn()} />);

      expect(input).toHaveValue('2026-09-23');
    });

    it('follows a new day from elsewhere when nothing is being typed', () => {
      const { rerender } = render(<DatePickerField id="date" finishedDatesOnly value="2026-09-20" onChange={jest.fn()} />);

      rerender(<DatePickerField id="date" finishedDatesOnly value="2026-10-01" onChange={jest.fn()} />);

      expect(screen.getByRole('textbox')).toHaveValue('2026-10-01');
    });

    it('does not show a refused day as saved', () => {
      render(<Saving accept={false} />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: '2026-09-21' } });
      fireEvent.blur(input);
      expect(input).toHaveValue('2026-09-20');

      fireEvent.click(screen.getByLabelText('Open calendar'));
      fireEvent.click(screen.getByTestId('select-date'));
      expect(input).toHaveValue('2026-09-20');
    });

    it('shows a picked day even when it is the one already saved', () => {
      const onSave = jest.fn();
      render(<Saving initial="2026-02-16" onSave={onSave} />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: '2026-02-1' } });
      fireEvent.click(screen.getByLabelText('Open calendar'));
      fireEvent.click(screen.getByTestId('select-date'));

      expect(onSave).toHaveBeenCalledWith('2026-02-16');
      expect(input).toHaveValue('2026-02-16');
    });

    it('shows a picked day once the caller takes it', () => {
      render(<Saving />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: '2026-1' } });
      fireEvent.click(screen.getByLabelText('Open calendar'));
      fireEvent.click(screen.getByTestId('select-date'));

      expect(input).toHaveValue('2026-02-16');
    });
  });
});
