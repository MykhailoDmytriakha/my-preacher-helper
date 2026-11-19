import { render, screen } from '@testing-library/react';
import React from 'react';

import SermonHeader, { type SermonHeaderEditor } from '@/components/sermon/SermonHeader';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: jest.fn(() => ({ isOnline: true, isMagicAvailable: true, checkConnection: jest.fn() })),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), message: jest.fn(), success: jest.fn() } }));
jest.mock('@utils/dateFormatter', () => ({
  formatDate: jest.fn(() => 'CREATED'),
  formatDateOnly: jest.fn((d: string) => `FMT(${d})`),
}));
jest.mock('@utils/exportContent', () => ({ getExportContent: jest.fn(async () => '') }));
jest.mock('@/components/dashboard/OptionMenu', () => () => <div data-testid="option-menu" />);
jest.mock('@/components/sermon/SourceNoteChips', () => () => null);
jest.mock('@/components/ExportButtons', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: jest.fn(() => ({ settings: { language: 'en' }, loading: false })),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => (key === 'dashboard.preached' ? 'Preached' : opts?.defaultValue ?? key),
  }),
}));

const form = (value: string) => ({
  active: false, busy: false, ready: true, value,
  begin: jest.fn(async () => undefined), update: jest.fn(async () => undefined),
  save: jest.fn(async () => undefined), cancel: jest.fn(async () => undefined),
});
const editor: SermonHeaderEditor = {
  subject: 's1', values: { title: 'T', verse: 'V' }, isReadOnly: false, status: null, error: null,
  titleForm: form('T'), verseForm: form('V'),
  keepLocal: jest.fn(async () => undefined), acceptRemote: jest.fn(async () => undefined), retry: jest.fn(async () => undefined),
};

const church = { id: 'c1', name: 'Grace', city: 'Kyiv' };
const base: Sermon = { id: 's1', userId: 'u', title: 'T', verse: 'V', date: '2026-01-01', thoughts: [] };
const pd = (status: 'planned' | 'preached', date: string) =>
  ({ id: `${status}-${date}`, date, status, church, createdAt: '2026-01-01T00:00:00Z' });

describe('SermonHeader preach dates', () => {
  it('shows the dates it is given in the line under the title, next to the creation date', () => {
    render(<SermonHeader sermon={{ ...base, preachDates: [pd('preached', '2026-03-01')] }} editor={editor}
      dates={<span data-testid="preach-dates">dates</span>} />);
    const dates = screen.getByTestId('preach-dates');
    expect(dates.parentElement).toBe(screen.getByText('CREATED').parentElement);
  });

  it('never shows a status chip of its own, so a date is not shown twice', () => {
    render(<SermonHeader sermon={{ ...base, preachDates: [pd('preached', '2026-03-01'), pd('planned', '2026-05-01')] }} editor={editor} />);
    expect(screen.queryByText('Preached')).not.toBeInTheDocument();
    expect(screen.queryByText('Planned')).not.toBeInTheDocument();
    expect(screen.queryByText('FMT(2026-03-01)')).not.toBeInTheDocument();
    expect(screen.queryByText('FMT(2026-05-01)')).not.toBeInTheDocument();
  });
});
