import { render, screen } from '@testing-library/react';
import React from 'react';

import PrayerStatusBadge from '@/components/prayer/PrayerStatusBadge';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const STATUSES = ['active', 'answered', 'not_answered'] as const;

/** The badge is a chip, so the plate lives on the chip, not on the label inside it. */
const chipFor = (status: (typeof STATUSES)[number]) =>
  screen.getByText(`prayer.status.${status}`).closest('span.rounded-full') as HTMLElement;

describe('PrayerStatusBadge', () => {
  it.each(STATUSES)('names the %s status and keeps the caller\'s class', (status) => {
    render(<PrayerStatusBadge status={status} className="extra-class" />);

    const chip = chipFor(status);
    expect(chip).toHaveClass('extra-class');
    expect(chip).toHaveClass('rounded-full', 'inline-flex', 'items-center');
  });

  it('gives each status a plate of its own', () => {
    const plates = STATUSES.map((status) => {
      const { unmount } = render(<PrayerStatusBadge status={status} />);
      const plate = (chipFor(status).className.match(/bg-[a-z]+-\d+/) ?? [])[0];
      unmount();
      return plate;
    });

    expect(plates.every(Boolean)).toBe(true);
    expect(new Set(plates).size).toBe(STATUSES.length);
  });
});
