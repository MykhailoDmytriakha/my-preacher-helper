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
    expect(result).toContain('export.otherThoughts');
  });

  test('exports plan in plain text format', async () => {
    const sermonWithPlan: Sermon = {
      ...baseSermon,
      plan: {
        introduction: { outline: 'Intro Outline' },
        main: { outline: 'Main Outline' },
        conclusion: { outline: 'Conclusion Outline' },
      }
    };

    const result = await getExportContent(sermonWithPlan, undefined, { type: 'plan', format: 'plain' });

    expect(result).toContain('export.sermonTitleTest');
    expect(result).toContain('tags.introduction:');
    expect(result).toContain('Intro Outline');
    // Plain text separator
    expect(result).toContain('---------------------');
  });

  test('exports plan in markdown format', async () => {
    const sermonWithPlan: Sermon = {
      ...baseSermon,
      plan: {
        introduction: { outline: 'Intro Outline' },
        main: { outline: 'Main Outline' },
        conclusion: { outline: 'Conclusion Outline' },
      },
      verse: 'John 3:16'
    };

    const result = await getExportContent(sermonWithPlan, undefined, { type: 'plan', format: 'markdown' });

    expect(result).toContain('# export.sermonTitleTest');
    expect(result).toContain('**export.scriptureText**');
    expect(result).toContain('> John 3:16');
    expect(result).toContain('## tags.introduction');
    expect(result).toContain('Intro Outline');
    // Markdown separator
    expect(result).toContain('---');
  });

  test('returns error message when no plan available', async () => {
    const result = await getExportContent(baseSermon, undefined, { type: 'plan' });
    expect(result).toBe('export.noPlanAvailable');
  });

  test('exports thoughts in markdown format including tags', async () => {
    const thoughts: Thought[] = [
      { id: 't1', text: 'Intro Thought', tags: ['Introduction'], date: '2023-01-01T10:00:00Z' }
    ];
    const sermon = { ...baseSermon, thoughts };
    const result = await getExportContent(sermon, undefined, { type: 'thoughts', format: 'markdown', includeTags: true });

    expect(result).toContain('## tags.introduction'); // Section header
    expect(result).toContain('1. Intro Thought');
    expect(result).toContain('*export.tagsLabelIntroduction*');
    expect(result).toContain('---');
  });

  test('filtering by focused section', async () => {
    const thoughts: Thought[] = [
      { id: 't1', text: 'Intro Thought', tags: ['Introduction'], date: '2023-01-01T10:00:00Z' },
      { id: 't2', text: 'Main Thought', tags: ['Main Part'], date: '2023-01-01T10:01:00Z' }
    ];
    const sermon = { ...baseSermon, thoughts };

    // Export only Introduction
    const result = await getExportContent(sermon, 'introduction');
    expect(result).toContain('Intro Thought');
    expect(result).not.toContain('Main Thought');
  });

  test('handles multi-tag thoughts', async () => {
    const thoughts: Thought[] = [
      { id: 't1', text: 'Multi Tag Thought', tags: ['Introduction', 'Main Part'], date: '2023-01-01T10:00:00Z' }
    ];
    const sermon = { ...baseSermon, thoughts };

    const result = await getExportContent(sermon);
    expect(result).toContain('export.multipleTagsThoughts');
    expect(result).toContain('Multi Tag Thought');
  });

  test('prioritizes outline point assignment', async () => {
    const outlinePointId = 'op1';
    const thoughts: Thought[] = [
      { id: 't1', text: 'Assigned Thought', tags: ['Introduction'], date: '2023-01-01T10:00:00Z', outlinePointId }
    ];
    const sermon: Sermon = {
      ...baseSermon,
      thoughts,
      outline: {
        introduction: [{ id: outlinePointId, text: 'Point A' }],
        main: [],
        conclusion: []
      }
    };

    const result = await getExportContent(sermon);
    expect(result).toContain('Point A:'); // Block title
    expect(result).toContain('Assigned Thought');
  });
});


