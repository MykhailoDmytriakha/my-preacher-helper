import { render, screen } from '@testing-library/react';
import React from 'react';

import SermonHeader from '@/components/sermon/SermonHeader';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: jest.fn(() => ({ isOnline: true, isMagicAvailable: true, checkConnection: jest.fn() })),
}));
jest.mock('@/services/sermon.service', () => ({ updateSermon: jest.fn(), getSermonById: jest.fn() }));
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
  useUserSettings: jest.fn(() => ({ settings: { enablePrepMode: true }, loading: false })),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => (key === 'dashboard.preached' ? 'Preached' : opts?.defaultValue ?? key),
  }),
}));

const church = { id: 'c1', name: 'Grace', city: 'Kyiv' };
const base: Sermon = { id: 's1', userId: 'u', title: 'T', verse: 'V', date: '2026-01-01', thoughts: [] };
const pd = (status: 'planned' | 'preached', date: string) =>
  ({ id: `${status}-${date}`, date, status, church, createdAt: '2026-01-01T00:00:00Z' });

describe('SermonHeader status chip', () => {
  it('shows the emerald preached chip with the latest preached date', () => {
    render(<SermonHeader sermon={{ ...base, preachDates: [pd('preached', '2026-03-01'), pd('preached', '2026-02-01')] }} />);
    const label = screen.getByText('Preached');
    expect(label).toBeInTheDocument();
    expect(screen.getByText('FMT(2026-03-01)')).toBeInTheDocument();
    expect(label.closest('span[class*="emerald"]')).not.toBeNull();
  });

  it('shows the amber planned chip when only a planned date exists', () => {
    render(<SermonHeader sermon={{ ...base, preachDates: [pd('planned', '2026-05-01')] }} />);
    const label = screen.getByText('Planned');
    expect(screen.getByText('FMT(2026-05-01)')).toBeInTheDocument();
    expect(label.closest('span[class*="amber"]')).not.toBeNull();
    expect(screen.queryByText('Preached')).not.toBeInTheDocument();
  });

  it('shows neither chip when the sermon has no preach dates', () => {
    render(<SermonHeader sermon={base} />);
    expect(screen.queryByText('Preached')).not.toBeInTheDocument();
    expect(screen.queryByText('Planned')).not.toBeInTheDocument();
  });
});
