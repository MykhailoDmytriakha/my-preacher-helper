import { createPlanUserMessage } from '@/config/prompts/user/planTemplate';
import { Sermon } from '@/models/models';

describe('createPlanUserMessage', () => {
  const baseSermon: Sermon = {
    id: 's1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2024-01-01',
    thoughts: [],
    userId: 'u1',
  };

  it('throws for invalid section names', () => {
    expect(() => createPlanUserMessage(baseSermon, 'invalid', 'content')).toThrow(
      /Invalid section/i
    );
  });

  it('includes outline points when present for the section', () => {
    const sermon: Sermon = {
      ...baseSermon,
      outline: {
        introduction: [
          { id: 'op1', text: 'Point One' },
          { id: 'op2', text: 'Point Two' },
        ],
        main: [],
        conclusion: [],
      },
    } as any;

    const msg = createPlanUserMessage(sermon, 'introduction', 'Body');
    expect(msg).toMatch(/MANDATORY OUTLINE STRUCTURE/);
    expect(msg).toMatch(/1\. Point One/);
    expect(msg).toMatch(/2\. Point Two/);
    expect(msg).toMatch(/CRITICAL REQUIREMENT: You MUST organize/);
  });

  it('omits outline block when no points are present', () => {
    const msg = createPlanUserMessage(baseSermon, 'main', 'Body');
    expect(msg).not.toMatch(/MANDATORY OUTLINE STRUCTURE/);
  });

  it('contains language and formatting guidance and verse requirement', () => {
    const msg = createPlanUserMessage(baseSermon, 'conclusion', 'Body');
    expect(msg).toMatch(/MEMORY-FRIENDLY FORMAT/);
    expect(msg).toMatch(/Use \*\*bold\*\*/);
    expect(msg).toMatch(/MANDATORY BIBLE VERSE REQUIREMENT/);
    expect(msg).toMatch(/RESPONSE LANGUAGE: Generate in the EXACT SAME LANGUAGE/);
  });

  it('marks non-English case when non-Latin chars detected', () => {
    const sermon: Sermon = {
      ...baseSermon,
      title: 'Тестовая проповедь', // Cyrillic
    };
    const msg = createPlanUserMessage(sermon, 'main', 'Body');
    expect(msg).toMatch(/non-English/);
  });
});

