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
});
