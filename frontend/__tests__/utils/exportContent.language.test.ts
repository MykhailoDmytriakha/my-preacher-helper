import { getExportContent } from '@/utils/exportContent';
import { i18n } from '@locales/i18n';

import type { Sermon } from '@/models/models';

jest.mock('@locales/i18n', () => ({ i18n: { t: jest.fn((key: string) => `en:${key}`) } }));

const sermon: Sermon = {
  id: 'language', userId: 'user', title: 'Author title', verse: 'John 1:1', date: '2026-01-01',
  thoughts: [{ id: 'thought', text: 'Author thought', tags: ['intro'], date: '2026-01-01' }],
  plan: { introduction: { outline: 'Author plan' }, main: { outline: '' }, conclusion: { outline: '' } },
};

it.each([['thoughts', 'plain'], ['thoughts', 'markdown'], ['plan', 'plain'], ['plan', 'markdown']] as const)('uses the current language for each %s/%s export without reloading the module', async (type, format) => {
    jest.mocked(i18n.t).mockImplementation(((key: string) => `en:${key}`) as typeof i18n.t);
    const first = await getExportContent(sermon, undefined, { type, format, includeTags: true });
    expect(first).toContain('en:export.sermonTitleAuthor title');
    jest.mocked(i18n.t).mockImplementation(((key: string) => `ru:${key}`) as typeof i18n.t);
    const second = await getExportContent(sermon, undefined, { type, format, includeTags: true });
    expect(second).toContain('ru:export.sermonTitleAuthor title');
    expect(second).toContain('ru:tags.introduction');
    expect(second).not.toContain('en:');
    expect(second).toContain(type === 'thoughts' ? 'Author thought' : 'Author plan');
});
