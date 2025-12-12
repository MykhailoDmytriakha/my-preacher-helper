import { getExportContent } from '@/utils/exportContent';

import type { Sermon, Thought } from '@/models/models';

describe('exportContent tag normalization', () => {
  const baseSermon: Sermon = {
    id: 's1',
    title: 'Test',
    verse: 'John 3:16',
    date: '2023-01-01',
    userId: 'u1',
    thoughts: [],
    outline: {
      introduction: [],
      main: [],
      conclusion: [],
    },
    structure: { introduction: [], main: [], conclusion: [], ambiguous: [] },
  };

  test('groups thoughts by section using normalized tags across languages', async () => {
    const thoughts: Thought[] = [
      { id: 't1', text: 'Intro EN long', tags: ['Introduction'], date: '2023-01-01T10:00:00Z' },
      { id: 't2', text: 'Main RU', tags: ['Основная часть'], date: '2023-01-01T10:01:00Z' },
      { id: 't3', text: 'Conclusion UK', tags: ['Висновок'], date: '2023-01-01T10:02:00Z' },
      { id: 't4', text: 'Ambiguous', tags: ['random'], date: '2023-01-01T10:03:00Z' },
    ];
    const sermon: Sermon = { ...baseSermon, thoughts };

    const result = await getExportContent(sermon, undefined, { format: 'plain', includeTags: false, includeMetadata: false });

    // In tests, i18n.t returns keys by default; assert keys present
    expect(result).toContain('tags.introduction:');
    expect(result).toContain('tags.mainPart:');
    expect(result).toContain('tags.conclusion:');
    expect(result).toContain('export.otherThoughts');
  });
});


