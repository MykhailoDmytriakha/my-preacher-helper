import { render, screen } from '@testing-library/react';
import React from 'react';

import PrayerStatusBadge from '@/components/prayer/PrayerStatusBadge';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('PrayerStatusBadge', () => {
  it.each([
    ['active', 'bg-blue-100 text-blue-700'],
    ['answered', 'bg-green-100 text-green-700'],
    ['not_answered', 'bg-gray-100 text-gray-600'],
  ] as const)('renders %s with the expected styling contract', (status, styleClass) => {
    render(<PrayerStatusBadge status={status} className="extra-class" />);

    const badge = screen.getByText(`prayer.status.${status}`);
    expect(badge).toHaveClass('extra-class');
    expect(badge.className).toContain(styleClass);
  });
});
