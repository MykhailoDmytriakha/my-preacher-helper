import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { PreachDateFields, type PreachDateValues } from '@/components/calendar/PreachDateFields';
import { CreateGroupView } from '@/components/groups/CreateGroupModal';
import SermonFormDialog, { type SermonFormValues } from '@/components/sermon/SermonFormDialog';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));

const dateInput = () => screen.getAllByRole('textbox').find(input => (input as HTMLInputElement).pattern) as HTMLInputElement;
const type = (text: string) => fireEvent.change(dateInput(), { target: { value: text } });
const church = { id: '', name: '', city: '' };

/**
 * BUG-20261003-date-form-accepts-impossible-day: a form refuses a day that is not in the calendar
 * when the person typed it there. A day that came from outside — a record saved with it, a recovered
 * draft, another device — is not refused, so the form still saves its other fields.
 */
describe('a date form and a day that is not in the calendar', () => {
  function PreachForm({ initial, outside }: { initial: string; outside?: string }) {
    const [value, setValue] = React.useState<PreachDateValues>({ date: initial, church, audience: '', notes: '' });
    React.useEffect(() => { if (outside) setValue(current => ({ ...current, date: outside })); }, [outside]);
    return <form><PreachDateFields value={value} onChange={patch => setValue(current => ({ ...current, ...patch }))} /></form>;
  }

  it('refuses one typed into a preach date, and takes a real day', () => {
    render(<PreachForm initial="2026-02-20" />);
    type('2026-02-31');
    expect(dateInput().checkValidity()).toBe(false);
    type('2026-02-28');
    expect(dateInput().checkValidity()).toBe(true);
  });

  it('keeps one a preach date was saved with or recovered with, and refuses another typed over it', () => {
    render(<PreachForm initial="2026-02-31" />);
    expect(dateInput().checkValidity()).toBe(true);
    type('2026-04-31');
    expect(dateInput().checkValidity()).toBe(false);
  });

  it('keeps one that arrives from outside after the person typed a real day', () => {
    const { rerender } = render(<PreachForm initial="2026-02-20" />);
    type('2026-02-21');
    rerender(<PreachForm initial="2026-02-20" outside="2026-02-31" />);
    expect(dateInput().value).toBe('2026-02-31');
    expect(dateInput().checkValidity()).toBe(true);
  });

  it('refuses one typed with a space the owner trims before showing it', () => {
    function Trimming() {
      const [stored, setStored] = React.useState('2026-02-20');
      return <form><PreachDateFields value={{ date: stored.trim(), church, audience: '', notes: '' }} onChange={patch => { if (patch.date !== undefined) setStored(patch.date); }} /></form>;
    }
    render(<Trimming />);
    type('2026-02-31 ');
    expect(dateInput().value).toBe('2026-02-31');
    expect(dateInput().checkValidity()).toBe(false);
  });

  it.each(['10/12/2024', ' 2026-03-10 ', '2026-02-11T00:00:00.000Z'])('shows a date stored as %j as its day, so the form still saves', (stored) => {
    render(<PreachForm initial={stored} />);
    expect(dateInput().value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dateInput().checkValidity()).toBe(true);
  });

  it.each(['2', '2026-0', '2026-02'])('shows a partial date %j stored by an older version as it is, not as a plausible day', (stored) => {
    render(<PreachForm initial={stored} />);
    expect(dateInput().value).toBe(stored);
  });

  function SermonForm({ initial }: { initial: string }) {
    const [values, setValues] = React.useState<SermonFormValues>({ title: 'T', verse: 'V', plannedDate: initial, seriesId: '' });
    return <SermonFormDialog heading="Sermon" values={values} onChange={patch => setValues(current => ({ ...current, ...patch }))}
      onSubmit={event => event.preventDefault()} onCancel={() => undefined} submitLabel="Save" saving={false} showPlannedDate />;
  }

  it('refuses one typed as a sermon\'s planned date, and keeps one it was saved with', () => {
    const { unmount } = render(<SermonForm initial="" />);
    type('2026-02-31');
    expect(dateInput().checkValidity()).toBe(false);
    unmount();
    render(<SermonForm initial="2026-02-31" />);
    expect(dateInput().checkValidity()).toBe(true);
  });

  function GroupForm({ initial }: { initial: string }) {
    const [date, setDate] = React.useState(initial);
    return <CreateGroupView title="G" setTitle={() => undefined} description="" setDescription={() => undefined}
      firstMeetingDate={date} setFirstMeetingDate={setDate} saving={false} onClose={() => undefined} handleSubmit={event => event.preventDefault()} />;
  }

  it('refuses one typed as a new group\'s first meeting, and keeps one a recovered draft holds', () => {
    const { unmount } = render(<GroupForm initial="" />);
    type('2026-02-31');
    expect(dateInput().checkValidity()).toBe(false);
    unmount();
    render(<GroupForm initial="2026-02-31" />);
    expect(dateInput().checkValidity()).toBe(true);
  });
});
