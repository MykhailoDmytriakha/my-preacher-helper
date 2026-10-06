import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import DatePickerField from '@/components/ui/DatePickerField';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));

/** BUG-20261003-old-meeting-date-format-shown-raw: meetings were once stored as midnight UTC. */
describe('a date field fed a stored date', () => {
  it.each([false, true])('shows a stored timestamp as its day (finishedDatesOnly=%s)', (finishedDatesOnly) => {
    render(<DatePickerField value="2026-02-11T00:00:00.000Z" onChange={jest.fn()} finishedDatesOnly={finishedDatesOnly} />);
    const field = screen.getByRole('textbox') as HTMLInputElement;
    expect(field.value).toBe('2026-02-11');
    expect(field.validity.patternMismatch).toBe(false);
  });

  it('leaves a day and an empty value as they are', () => {
    const { rerender } = render(<DatePickerField value="2026-10-06" onChange={jest.fn()} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('2026-10-06');
    rerender(<DatePickerField value="" onChange={jest.fn()} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });
});

/** Review: typed text is the person's, even when it starts like a stored timestamp. */
describe('a date field the person types into', () => {
  function Form({ onValue }: { onValue: (value: string) => void }) {
    const [value, setValue] = useState('');
    return <DatePickerField value={value} onChange={(next) => { setValue(next); onValue(next); }} />;
  }

  it.each(['2026-02-11 ', '2026-02-11T', '2026-02-11Tgarbage', '2026-02-11T10:00'])('shows %j as typed, so the form refuses it', (typed) => {
    const onValue = jest.fn();
    render(<Form onValue={onValue} />);
    const field = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(field, { target: { value: typed } });
    expect(onValue).toHaveBeenLastCalledWith(typed);
    expect(field.value).toBe(typed);
    expect(field.validity.patternMismatch).toBe(true);
  });
});
