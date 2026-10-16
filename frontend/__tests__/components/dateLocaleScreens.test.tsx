import { render } from '@testing-library/react';

import ShareLinksPanel from '@/(pages)/(private)/studies/components/ShareLinksPanel';
import StudyNoteCard from '@/(pages)/(private)/studies/StudyNoteCard';
import GroupCard from '@/components/groups/GroupCard';
import PrayerRequestCard from '@/components/prayer/PrayerRequestCard';
import { SeriesDetailView } from '@/components/series/SeriesDetailView';
import { skippedWrite } from '@/utils/recoverableWrite';

import type { PrayerRequest, Series, StudyNote, StudyNoteShareLink } from '@/models/models';

let mockLanguage = 'ru';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: mockLanguage },
  }),
}));
jest.mock('@/hooks/useClipboard', () => ({
  useClipboard: () => ({ isCopied: false, copyToClipboard: jest.fn(), reset: jest.fn() }),
}));

const date = new Date(2026, 0, 15, 12).toISOString();
const note: StudyNote = {
  id: 'note', userId: 'owner', title: 'Study', content: 'Text',
  scriptureRefs: [], tags: [], isDraft: false, createdAt: date, updatedAt: date,
};
const prayer: PrayerRequest = {
  id: 'prayer', userId: 'owner', title: 'Prayer', description: '', status: 'answered',
  updates: [], createdAt: date, updatedAt: date, answeredAt: date,
};
const series: Series = {
  id: 'series', userId: 'owner', title: 'Series', theme: 'Theme', bookOrTopic: 'Topic',
  sermonIds: [], status: 'draft', startDate: date, createdAt: date, updatedAt: date,
};
const shareLink: StudyNoteShareLink = {
  id: 'link', ownerId: 'owner', noteId: note.id, token: 'token', createdAt: date, viewCount: 0,
};

function screenFor(kind: string) {
  switch (kind) {
    case 'prayer':
      return <PrayerRequestCard prayer={prayer} onSetStatus={() => skippedWrite()} onDelete={() => skippedWrite()} onAddUpdate={jest.fn()} onEdit={jest.fn()} />;
    case 'study':
      return <StudyNoteCard note={note} bibleLocale="en" isExpanded onToggleExpand={jest.fn()} onEdit={jest.fn()} />;
    case 'series':
      return <SeriesDetailView series={series} items={[]} itemsContent={null}
        onBack={jest.fn()} onAddSermons={jest.fn()} onAddGroups={jest.fn()} onEdit={jest.fn()} onDelete={jest.fn()} onRefresh={jest.fn()} />;
    case 'share link':
      return <ShareLinksPanel notes={[note]} shareLinks={[shareLink]} onCreate={() => skippedWrite()} onDelete={() => skippedWrite()} />;
    default:
      throw new Error('Unknown date display');
  }
}

describe('Dates follow the interface language', () => {
  it.each(['prayer', 'study', 'series', 'share link'])('%s updates all numeric dates when the app language changes', (kind) => {
    mockLanguage = 'ru-RU';
    const view = render(screenFor(kind));
    expect(view.container).toHaveTextContent('15.01.2026');
    expect(view.container).not.toHaveTextContent('1/15/2026');

    mockLanguage = 'en-US';
    view.rerender(screenFor(kind));
    expect(view.container).toHaveTextContent('1/15/2026');
    expect(view.container).not.toHaveTextContent('15.01.2026');

    mockLanguage = 'uk-UA';
    view.rerender(screenFor(kind));
    expect(view.container).toHaveTextContent('15.01.2026');
    expect(view.container).not.toHaveTextContent('1/15/2026');
  });

  it('formats a group meeting in the app language while preserving its calendar day', () => {
    const group = {
      id: 'group', userId: 'owner', title: 'Group', status: 'draft' as const,
      templates: [], flow: [], meetingDates: [{ id: 'meeting', date: '2026-01-15', createdAt: date }],
      createdAt: date, updatedAt: date,
    };
    mockLanguage = 'ru-RU';
    const view = render(<GroupCard group={group} />);
    const expected = new Date(2026, 0, 15).toLocaleDateString('ru', {
      day: '2-digit', month: 'short', year: 'numeric',
    }).replace(/\s+/g, ' ');
    expect(view.container).toHaveTextContent(expected);
    mockLanguage = 'en-US';
    view.rerender(<GroupCard group={group} />);
    expect(view.container).toHaveTextContent('Jan 15, 2026');
  });
});
