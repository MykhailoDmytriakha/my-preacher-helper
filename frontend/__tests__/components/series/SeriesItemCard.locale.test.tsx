import { render, screen } from '@testing-library/react';

import SeriesItemCard from '@/components/series/SeriesItemCard';
import en from '../../../locales/en/translation.json';
import ru from '../../../locales/ru/translation.json';
import uk from '../../../locales/uk/translation.json';

import type { Group } from '@/models/models';
import type { ReactNode } from 'react';

const mockI18n = jest.requireActual<typeof import('i18next')>('i18next').createInstance();

jest.mock('@locales/useTranslation', () => ({
  useTranslation: () => ({ t: mockI18n.t.bind(mockI18n), language: mockI18n.language }),
}));

jest.mock('next/link', () => function MockLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href}>{children}</a>;
});

beforeAll(async () => {
  await mockI18n.init({
    lng: 'en', fallbackLng: 'en', initImmediate: false,
    resources: { en: { translation: en }, ru: { translation: ru }, uk: { translation: uk } },
    interpolation: { escapeValue: false },
  });
});

it.each([['en', en], ['ru', ru], ['uk', uk]] as const)(
  'labels group meeting counts with the actual %s vocabulary and omits an empty count',
  async (language, words) => {
    await mockI18n.changeLanguage(language);
    const group: Group = {
      id: 'group-1', userId: 'owner', title: 'A group with two meetings', status: 'active',
      createdAt: '2026-10-20', updatedAt: '2026-10-20', templates: [], flow: [],
      meetingDates: [
        { id: 'meeting-1', date: '2026-10-20', createdAt: '2026-10-20' },
        { id: 'meeting-2', date: '2026-10-27', createdAt: '2026-10-20' },
      ],
    };
    const props = {
      id: 'series-group', position: 1, sortable: false,
      resolvedItem: { item: { id: 'series-group', type: 'group' as const, refId: group.id, position: 0 }, group },
    };
    const { rerender } = render(<SeriesItemCard {...props} />);

    expect(screen.getByText(`${words.workspaces.groups.itemsLabel.meetings}: 2`)).toBeInTheDocument();
    expect(screen.queryByText(`${words.calendar.analytics.totalPreachings}: 2`)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: group.title })).toHaveAttribute('href', '/groups/group-1');

    rerender(<SeriesItemCard {...props} resolvedItem={{ ...props.resolvedItem, group: { ...group, meetingDates: [] } }} />);
    expect(screen.queryByText(`${words.workspaces.groups.itemsLabel.meetings}: 0`)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: group.title })).toBeInTheDocument();
  },
);
