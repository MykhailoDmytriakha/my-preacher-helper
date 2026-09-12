import {
  getPrayerSearchTarget,
  getPrayerUpdateSearchSnippet,
  matchesPrayerQuery,
} from '@/utils/prayerSearch';
import { PrayerRequest } from '@/models/models';

const prayer: PrayerRequest = {
  id: 'prayer-1',
  userId: 'user-1',
  title: 'Pray for church',
  description: 'Sunday service and unity',
  tags: ['community'],
  status: 'answered',
  updates: [
    { id: 'old-update', text: 'Community meeting planned', createdAt: '2026-03-15T10:00:00.000Z' },
    { id: 'latest-update', text: 'Community breakthrough after prayer', createdAt: '2026-03-18T10:00:00.000Z' },
  ],
  createdAt: '2026-03-10T09:00:00.000Z',
  updatedAt: '2026-03-18T10:00:00.000Z',
  answeredAt: '2026-03-18T10:00:00.000Z',
  answerText: 'Community answer received',
};

describe('prayerSearch', () => {
  it('requires every token in one candidate text', () => {
    const disabled = { searchInUpdates: false, searchInTags: false, searchInAnswerText: false };
    expect(matchesPrayerQuery(prayer, 'Sunday unity', disabled)).toBe(true);
    expect(matchesPrayerQuery(prayer, 'Sunday missing', disabled)).toBe(false);
    expect(matchesPrayerQuery({ ...prayer, title: 'Sunday', description: 'unity' }, 'Sunday unity', disabled)).toBe(false);
  });

  it('respects optional update, tag, and answer search flags', () => {
    const disabled = { searchInUpdates: false, searchInTags: false, searchInAnswerText: false };
    expect(matchesPrayerQuery(prayer, 'breakthrough prayer', disabled)).toBe(false);
    expect(matchesPrayerQuery(prayer, 'breakthrough prayer', { ...disabled, searchInUpdates: true })).toBe(true);
    expect(matchesPrayerQuery(prayer, 'community', disabled)).toBe(false);
    expect(matchesPrayerQuery(prayer, 'community', { ...disabled, searchInTags: true })).toBe(true);
    expect(matchesPrayerQuery(prayer, 'answer received', disabled)).toBe(false);
    expect(matchesPrayerQuery(prayer, 'answer received', { ...disabled, searchInAnswerText: true })).toBe(true);
  });

  it('chooses target fields by priority and the latest matching update', () => {
    expect(getPrayerSearchTarget(prayer, 'Pray church')).toEqual({ type: 'title' });
    expect(getPrayerSearchTarget(prayer, 'Sunday unity')).toEqual({ type: 'description' });
    expect(getPrayerSearchTarget(prayer, 'community')).toEqual({ type: 'update', updateId: 'latest-update' });
    expect(getPrayerSearchTarget(prayer, 'answer received')).toEqual({ type: 'answer' });
    expect(getPrayerSearchTarget({ ...prayer, updates: [], answerText: '' }, 'community')).toEqual({ type: 'tags' });
  });

  it('returns a snippet from the latest matching update', () => {
    expect(getPrayerUpdateSearchSnippet(prayer, 'breakthrough prayer')).toContain(
      'Community breakthrough after prayer'
    );
    expect(getPrayerUpdateSearchSnippet(prayer, 'missing')).toBeNull();
  });

  it('returns no navigation target for empty or unmatched queries', () => {
    expect(getPrayerSearchTarget(prayer, '   ')).toBeNull();
    expect(getPrayerSearchTarget(prayer, 'missing')).toBeNull();
    expect(getPrayerSearchTarget({ ...prayer, tags: undefined, updates: [], answerText: undefined }, 'community')).toBeNull();
  });
});
