import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import CalendarPage from '../../../app/(pages)/(private)/calendar/page';
import { useCalendarCouncils } from '@/hooks/useCalendarCouncils';
import { useCalendarGroups } from '@/hooks/useCalendarGroups';
import { useCalendarNotes } from '@/hooks/useCalendarNotes';
import { useCalendarPrayers } from '@/hooks/useCalendarPrayers';
import { useCalendarSermons } from '@/hooks/useCalendarSermons';
import { useSeries } from '@/hooks/useSeries';

import type { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

jest.mock('@/hooks/useCalendarSermons', () => ({ useCalendarSermons: jest.fn() }));
jest.mock('@/hooks/useCalendarGroups', () => ({ useCalendarGroups: jest.fn() }));
jest.mock('@/hooks/useCalendarCouncils', () => ({ useCalendarCouncils: jest.fn() }));
jest.mock('@/hooks/useCalendarNotes', () => ({ useCalendarNotes: jest.fn() }));
jest.mock('@/hooks/useCalendarPrayers', () => ({ useCalendarPrayers: jest.fn() }));
jest.mock('@/hooks/useSeries', () => ({ useSeries: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
// The month's drawing is not the subject; the warning and the date form are real.
jest.mock('@/components/calendar/PreachCalendar', () => () => null);
jest.mock('@/components/calendar/DateEventList', () => () => null);
jest.mock('@/components/calendar/AgendaView', () => () => null);
jest.mock('@/components/calendar/AnalyticsSection', () => () => null);
// The engine's form is the subject's boundary here: what it is opened with, not how it saves.
jest.mock('@/components/calendar/EnginePreachDateModal', () => ({
  EnginePreachDateModal: ({ sermonId, action }: { sermonId: string; action: unknown }) =>
    <div data-testid="engine-preach-date-modal" data-sermon={sermonId} data-action={JSON.stringify(action)} />,
}));

/**
 * ADDING A DATE TO A SERMON PREACHED WITHOUT ONE, FROM THE CALENDAR, ON THE ENGINE
 * (BUG-20261006-calendar-legacy-date-modal-refuses-on-engine, not reproduced). The calendar opens
 * `EnginePreachDateModal`, the engine's own form — the same one the sermon menu
 * opens — so no other writer is reached.
 */
const pending: Sermon = { id: 'old-sermon', title: 'Preached long ago', verse: 'John 3:16', date: '2024-01-02',
  thoughts: [], userId: 'owner', isPreached: true, preachDates: [] };

beforeEach(() => {
    jest.mocked(useCalendarSermons).mockReturnValue({ sermons: [pending], sermonsByDate: {}, pendingSermons: [pending],
    isLoading: false, error: null, refetch: jest.fn() } as never);
  jest.mocked(useCalendarGroups).mockReturnValue({ groups: [], isLoading: false, error: null, refetch: jest.fn() } as never);
  jest.mocked(useCalendarCouncils).mockReturnValue({ entries: [], isLoading: false, error: null });
  jest.mocked(useCalendarNotes).mockReturnValue({ entries: [], isLoading: false, error: null });
  jest.mocked(useCalendarPrayers).mockReturnValue({ entries: [], isLoading: false, error: null });
  jest.mocked(useSeries).mockReturnValue({ series: [], loading: false, error: null } as never);
});

it('adds the date of a sermon preached without one through the engine form, as preached', () => {
  render(<CalendarPage />);
  fireEvent.click(screen.getByRole('button', { name: 'calendar.addDateNow' }));

  const form = screen.getByTestId('engine-preach-date-modal');
  expect(form).toHaveAttribute('data-sermon', 'old-sermon');
  expect(JSON.parse(form.getAttribute('data-action')!)).toMatchObject({ kind: 'add', status: 'preached' });
});
