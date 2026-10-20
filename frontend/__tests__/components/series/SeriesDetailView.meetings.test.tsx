import { render, screen, within } from '@testing-library/react';

import { SeriesDetailView } from '@/components/series/SeriesDetailView';
import en from '../../../locales/en/translation.json';
import ru from '../../../locales/ru/translation.json';
import uk from '../../../locales/uk/translation.json';

import type { ResolvedSeriesItem } from '@/components/series/SeriesDetailView';
import type { Group, Series } from '@/models/models';

const mockI18n = jest.requireActual<typeof import('i18next')>('i18next').createInstance();

jest.mock('@locales/useTranslation', () => ({
  useTranslation: () => ({ t: mockI18n.t.bind(mockI18n), language: mockI18n.language }),
}));

const stamp = '2026-10-20T12:00:00Z';
const series: Series = {
  id: 'series', userId: 'owner', title: 'Meeting series', theme: 'Theme', bookOrTopic: 'Topic',
  sermonIds: [], status: 'active', createdAt: stamp, updatedAt: stamp,
};
const actions = { onBack: jest.fn(), onAddSermons: jest.fn(), onAddGroups: jest.fn(),
  onEdit: jest.fn(), onDelete: jest.fn(), onRefresh: jest.fn() };

function groupEntry(id: string, dates?: string[]): ResolvedSeriesItem {
  const group: Group = { id, userId: 'owner', title: id, status: 'active', templates: [], flow: [],
    createdAt: stamp, updatedAt: stamp,
    meetingDates: dates?.map((date, index) => ({ id: `${id}-meeting-${index}`, date, createdAt: stamp })),
  };
  return { item: { id: `item-${id}`, type: 'group', refId: id, position: 1 }, group };
}

function metric(meetings = en.workspaces.groups.itemsLabel.meetings, conducted = en.workspaces.series.detail.conductedMeetings) {
  // Accept the old caption here so the count regression fails on arithmetic, not a missing label.
  const caption = screen.getByText((text, node) => node?.tagName === 'P' && [
    meetings, conducted,
  ].includes(text));
  return within(caption.parentElement!).getByText(/^(?:\d+|—)$/);
}

beforeAll(async () => {
  await mockI18n.init({ lng: 'en', fallbackLng: 'en', initImmediate: false,
    resources: { en: { translation: en }, ru: { translation: ru }, uk: { translation: uk } },
    interpolation: { escapeValue: false },
  });
});
beforeEach(async () => { await mockI18n.changeLanguage('en'); });

describe('The series meeting metric counts meeting identities', () => {
  it.each([['en', en], ['ru', ru], ['uk', uk]] as const)('sums every group meeting in %s', async (language, words) => {
    await mockI18n.changeLanguage(language);
    render(<SeriesDetailView {...actions} series={series} itemsContent={null} items={[
      groupEntry('past', ['2026-10-18', '2026-10-19']), groupEntry('future', ['2027-12-31']),
      groupEntry('undated', ['']), groupEntry('empty', []),
    ]} />);
    expect(metric(words.workspaces.groups.itemsLabel.meetings, words.workspaces.series.detail.conductedMeetings)).toHaveTextContent(/^4$/);
  });

  it.each([['en', en], ['ru', ru], ['uk', uk]] as const)('uses the honest meeting caption in %s', async (language, words) => {
    await mockI18n.changeLanguage(language);
    render(<SeriesDetailView {...actions} series={series} itemsContent={null} items={[groupEntry('future', ['2027-12-31'])]} />);
    expect(screen.queryByText(words.workspaces.series.detail.conductedMeetings, { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(words.workspaces.groups.itemsLabel.meetings, { selector: 'p', exact: true })).toBeInTheDocument();
  });

  it('keeps a meeting when its date is cleared and subtracts only an explicitly removed meeting', () => {
    const entry = groupEntry('group', ['2026-10-18', '2026-10-19']);
    const view = render(<SeriesDetailView {...actions} series={series} itemsContent={null} items={[entry]} />);
    expect(metric()).toHaveTextContent(/^2$/);
    const first = entry.group!.meetingDates![0];
    const rest = entry.group!.meetingDates![1];
    view.rerender(<SeriesDetailView {...actions} series={series} itemsContent={null} items={[
      { ...entry, group: { ...entry.group!, meetingDates: [{ ...first, date: '' }, rest] } },
    ]} />);
    expect(metric()).toHaveTextContent(/^2$/);
    view.rerender(<SeriesDetailView {...actions} series={series} itemsContent={null} items={[
      { ...entry, group: { ...entry.group!, meetingDates: [rest] } },
    ]} />);
    expect(metric()).toHaveTextContent(/^1$/);
  });

  it('counts future and undated records without inventing completion from the date', () => {
    render(<SeriesDetailView {...actions} series={series} itemsContent={null} items={[
      groupEntry('future', ['2027-12-31']), groupEntry('undated', ['']),
    ]} />);
    expect(metric()).toHaveTextContent(/^2$/);
  });

  it('does not invent meetings from an empty or unresolved group or a sermon', () => {
    const missing = groupEntry('missing');
    render(<SeriesDetailView {...actions} series={series} itemsContent={null} items={[
      groupEntry('empty', []), groupEntry('unset'), { item: missing.item },
      { item: { id: 'sermon', type: 'sermon', refId: 'sermon', position: 2 } },
    ]} />);
    expect(metric()).toHaveTextContent(/^0$/);
  });

  it.each(['loading', 'failed'] as const)('does not publish a total while group reads are %s', groupsRead => {
    render(<SeriesDetailView {...actions} series={series} itemsContent={null} items={[
      groupEntry('held', ['2026-10-18', '2026-10-19']),
    ]} groupsRead={groupsRead} />);
    expect(metric()).toHaveTextContent(/^—$/);
  });
});
