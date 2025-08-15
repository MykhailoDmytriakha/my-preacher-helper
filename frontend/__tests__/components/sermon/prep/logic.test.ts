import { getActiveStepId } from '@/components/sermon/prep/logic';

describe('prep logic: getActiveStepId', () => {
  it('returns spiritual when readAndPrayed is false/undefined', () => {
    expect(getActiveStepId({} as any)).toBe('spiritual');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: false } } as any)).toBe('spiritual');
  });

  it('returns textContext when readAndPrayed is true but readWholeBookOnce is false', () => {
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true } } as any)).toBe('textContext');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: false } } as any)).toBe('textContext');
  });

  it('returns exegeticalPlan when both spiritual and readWholeBookOnce are true', () => {
    // With stricter gating, still textContext until notes and repeated words are provided
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true } } as any)).toBe('textContext');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true, contextNotes: '' } } as any)).toBe('textContext');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true, contextNotes: 'Some context' } } as any)).toBe('textContext');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true, contextNotes: 'Some context', repeatedWords: [] } } as any)).toBe('textContext');
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true, contextNotes: 'Some context', repeatedWords: ['love', 'faith'] } } as any)).toBe('exegeticalPlan');
  });

  it('returns exegeticalPlan when textContext is complete but exegetical plan is incomplete', () => {
    const completeTextContext = {
      spiritual: { readAndPrayedConfirmed: true },
      textContext: { 
        readWholeBookOnceConfirmed: true, 
        contextNotes: 'Some context', 
        repeatedWords: ['love', 'faith'] 
      }
    };

    // No exegetical plan
    expect(getActiveStepId(completeTextContext as any)).toBe('exegeticalPlan');
    
    // Empty exegetical plan
    expect(getActiveStepId({ ...completeTextContext, exegeticalPlan: [] } as any)).toBe('exegeticalPlan');
    
    // Exegetical plan with empty titles
    expect(getActiveStepId({ 
      ...completeTextContext, 
      exegeticalPlan: [{ id: '1', title: '', children: [] }] 
    } as any)).toBe('exegeticalPlan');
    
    // Exegetical plan with titles but no author intent
    expect(getActiveStepId({ 
      ...completeTextContext, 
      exegeticalPlan: [{ id: '1', title: 'Main Point', children: [] }] 
    } as any)).toBe('exegeticalPlan');
    
    // Exegetical plan with titles and author intent
    expect(getActiveStepId({ 
      ...completeTextContext, 
      exegeticalPlan: [{ id: '1', title: 'Main Point', children: [] }],
      authorIntent: 'Author wanted to teach about love'
    } as any)).toBe('mainIdea');
  });

  it('returns mainIdea when exegetical plan is complete', () => {
    const completeExegeticalPlan = {
      spiritual: { readAndPrayedConfirmed: true },
      textContext: { 
        readWholeBookOnceConfirmed: true, 
        contextNotes: 'Some context', 
        repeatedWords: ['love', 'faith'] 
      },
      exegeticalPlan: [
        { id: '1', title: 'Main Point', children: [] },
        { id: '2', title: 'Sub Point', children: [
          { id: '2.1', title: 'Detail', children: [] }
        ]}
      ],
      authorIntent: 'Author wanted to teach about love'
    };

    expect(getActiveStepId(completeExegeticalPlan as any)).toBe('mainIdea');
  });

  it('handles exegetical plan with nested children correctly', () => {
    const completeTextContext = {
      spiritual: { readAndPrayedConfirmed: true },
      textContext: { 
        readWholeBookOnceConfirmed: true, 
        contextNotes: 'Some context', 
        repeatedWords: ['love', 'faith'] 
      }
    };

    // Exegetical plan with only empty parent titles but valid child titles
    expect(getActiveStepId({ 
      ...completeTextContext, 
      exegeticalPlan: [{ 
        id: '1', 
        title: '', 
        children: [{ id: '1.1', title: 'Valid Child Title', children: [] }] 
      }],
      authorIntent: 'Author intent'
    } as any)).toBe('mainIdea');

    // Exegetical plan with valid parent titles but empty child titles
    expect(getActiveStepId({ 
      ...completeTextContext, 
      exegeticalPlan: [{ 
        id: '1', 
        title: 'Valid Parent Title', 
        children: [{ id: '1.1', title: '', children: [] }] 
      }],
      authorIntent: 'Author intent'
    } as any)).toBe('mainIdea');

    // Exegetical plan with deep nesting
    expect(getActiveStepId({ 
      ...completeTextContext, 
      exegeticalPlan: [{ 
        id: '1', 
        title: '', 
        children: [{ 
          id: '1.1', 
          title: '', 
          children: [{ 
            id: '1.1.1', 
            title: 'Deep Valid Title', 
            children: [] 
          }] 
        }] 
      }],
      authorIntent: 'Author intent'
    } as any)).toBe('mainIdea');
  });

  it('handles edge cases for exegetical plan completion', () => {
    const completeTextContext = {
      spiritual: { readAndPrayedConfirmed: true },
      textContext: { 
        readWholeBookOnceConfirmed: true, 
        contextNotes: 'Some context', 
        repeatedWords: ['love', 'faith'] 
      }
    };

    // Exegetical plan with whitespace-only titles
    expect(getActiveStepId({ 
      ...completeTextContext, 
      exegeticalPlan: [{ id: '1', title: '   ', children: [] }],
      authorIntent: 'Author intent'
    } as any)).toBe('exegeticalPlan');

    // Exegetical plan with null/undefined titles
    expect(getActiveStepId({ 
      ...completeTextContext, 
      exegeticalPlan: [{ id: '1', title: null as any, children: [] }],
      authorIntent: 'Author intent'
    } as any)).toBe('exegeticalPlan');

    // Exegetical plan with empty author intent
    expect(getActiveStepId({ 
      ...completeTextContext, 
      exegeticalPlan: [{ id: '1', title: 'Valid Title', children: [] }],
      authorIntent: ''
    } as any)).toBe('exegeticalPlan');

    // Exegetical plan with whitespace-only author intent
    expect(getActiveStepId({ 
      ...completeTextContext, 
      exegeticalPlan: [{ id: '1', title: 'Valid Title', children: [] }],
      authorIntent: '   '
    } as any)).toBe('exegeticalPlan');
  });

  it('handles mixed completion states correctly', () => {
    const basePrep = {
      spiritual: { readAndPrayedConfirmed: true },
      textContext: { 
        readWholeBookOnceConfirmed: true, 
        contextNotes: 'Some context', 
        repeatedWords: ['love', 'faith'] 
      }
    };

    // Partially complete exegetical plan
    expect(getActiveStepId({ 
      ...basePrep, 
      exegeticalPlan: [
        { id: '1', title: 'Valid Title', children: [] },
        { id: '2', title: '', children: [] }
      ],
      authorIntent: 'Author intent'
    } as any)).toBe('mainIdea'); // Should still be complete if at least one node has title

    // Multiple nodes with mixed completion
    expect(getActiveStepId({ 
      ...basePrep, 
      exegeticalPlan: [
        { id: '1', title: '', children: [] },
        { id: '2', title: 'Valid Title', children: [] },
        { id: '3', title: '', children: [] }
      ],
      authorIntent: 'Author intent'
    } as any)).toBe('mainIdea'); // Should be complete if at least one node has title
  });

  it('handles null/undefined preparation data gracefully', () => {
    expect(getActiveStepId(null)).toBe('spiritual');
    expect(getActiveStepId(undefined)).toBe('spiritual');
    expect(getActiveStepId({} as any)).toBe('spiritual');
  });

  it('handles partial preparation data correctly', () => {
    // Only spiritual step
    expect(getActiveStepId({ spiritual: { readAndPrayedConfirmed: true } } as any)).toBe('textContext');

    // Spiritual + partial text context
    expect(getActiveStepId({ 
      spiritual: { readAndPrayedConfirmed: true },
      textContext: { readWholeBookOnceConfirmed: true }
    } as any)).toBe('textContext');

    // Spiritual + text context without notes
    expect(getActiveStepId({ 
      spiritual: { readAndPrayedConfirmed: true },
      textContext: { 
        readWholeBookOnceConfirmed: true,
        contextNotes: 'Some notes'
      }
    } as any)).toBe('textContext');

    // Spiritual + text context without repeated words
    expect(getActiveStepId({ 
      spiritual: { readAndPrayedConfirmed: true },
      textContext: { 
        readWholeBookOnceConfirmed: true,
        contextNotes: 'Some notes',
        repeatedWords: []
      }
    } as any)).toBe('textContext');
  });
});


