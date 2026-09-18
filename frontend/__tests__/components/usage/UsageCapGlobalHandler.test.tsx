import { act, render, screen } from '@testing-library/react';
import React from 'react';

import UsageCapGlobalHandler from '@/components/usage/UsageCapGlobalHandler';
import { notifyUsageCapReached } from '@/services/usageCapClient';
import { UsageCapReachedError } from '@/services/usageLimits';

const invalidateQueries = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'graceVerses:verses') return ['Verse one', 'Verse two', 'Verse three', 'Verse four'];
      if (values && 'date' in values) return `${key}:${String(values.date)}`;
      return key;
    },
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

jest.mock('next/link', () => ({ children, href, onClick }: any) => (
  <a href={href} onClick={onClick}>{children}</a>
));

const capError = () => new UsageCapReachedError('transcription', 110, 100, 110, '2026-10-01T00:00:00.000Z');

/**
 * BEING REFUSED IS THE ONE USAGE MESSAGE THAT MUST NOT BE A TOAST.
 *
 * It stops the person mid-sentence, and it was told in the app's most fleeting form: a toast,
 * under a SECOND toast carrying the raw `Usage cap reached for ai` from the error object. The
 * warm words sat below the fold, had to be hovered to be read, and then timed out.
 */
describe('UsageCapGlobalHandler', () => {
  beforeEach(() => invalidateQueries.mockClear());

  it('says nothing until a request is actually refused', () => {
    render(<UsageCapGlobalHandler />);
    expect(screen.queryByTestId('usage-cap-dialog')).not.toBeInTheDocument();
  });

  it('holds the refusal on screen as a dialog, with the verse and the way to the plan', () => {
    render(<UsageCapGlobalHandler />);

    act(() => { notifyUsageCapReached(capError()); });

    const dialog = screen.getByTestId('usage-cap-dialog');
    expect(dialog).toHaveTextContent('usageGrace.capDialog.title');
    expect(dialog).toHaveTextContent('usageGrace.metrics.transcription');
    expect(dialog).toHaveTextContent('usageGrace.hardCap');
    expect(screen.getByTestId('usage-cap-dialog-verse').textContent).toMatch(/^Verse /);
    expect(screen.getByRole('link', { name: 'usageGrace.openSettings' })).toHaveAttribute('href', '/settings/limits');
  });

  it('refreshes what the usage panels are showing, since the counters just moved', () => {
    render(<UsageCapGlobalHandler />);

    act(() => { notifyUsageCapReached(capError()); });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: expect.arrayContaining(['me', 'entitlement', 'v2']) });
  });
});
