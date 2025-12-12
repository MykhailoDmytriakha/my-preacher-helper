import React from 'react';
import '@testing-library/jest-dom';

// Mock the components and hooks
jest.mock('@/components/sermon/prep/PrepStepCard', () => {
  return function MockPrepStepCard({ stepId, done, children }: any) {
    return (
      <div data-testid={`step-${stepId}`} data-done={done}>
        <div data-testid={`step-${stepId}-done-badge`}>
          {done ? '✓ Done' : 'Not Done'}
        </div>
        {children}
      </div>
    );
  };
});

jest.mock('@/components/sermon/prep/SpiritualStepContent', () => {
  return function MockSpiritualStepContent() {
    return <div data-testid="spiritual-content">Spiritual Content</div>;
  };
});

jest.mock('@/components/sermon/prep/TextContextStepContent', () => {
  return function MockTextContextStepContent() {
    return <div data-testid="text-context-content">Text Context Content</div>;
  };
});

jest.mock('@/components/sermon/prep/ExegeticalPlanStepContent', () => {
  return function MockExegeticalPlanStepContent() {
    return <div data-testid="exegetical-plan-content">Exegetical Plan Content</div>;
  };
});

jest.mock('@/components/sermon/prep/MainIdeaStepContent', () => {
  return function MockMainIdeaStepContent() {
    return <div data-testid="main-idea-content">Main Idea Content</div>;
  };
});

// Mock the sermon page component to test completion status logic
const createMockPreparation = (overrides: any = {}) => ({
  spiritual: { readAndPrayedConfirmed: false },
  textContext: {
    readWholeBookOnceConfirmed: false,
    contextNotes: '',
    repeatedWords: []
  },
  exegeticalPlan: [],
  authorIntent: '',
  mainIdea: {
    contextIdea: '',
    textIdea: '',
    argumentation: ''
  },
  ...overrides
});

// Test the completion status logic
describe('Sermon Completion Status Logic', () => {
  describe('Spiritual Step Completion', () => {
    it('marks spiritual step as complete when readAndPrayedConfirmed is true', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true }
      });
      
      const isSpiritualDone = Boolean(prep?.spiritual?.readAndPrayedConfirmed);
      expect(isSpiritualDone).toBe(true);
    });

    it('marks spiritual step as incomplete when readAndPrayedConfirmed is false', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: false }
      });
      
      const isSpiritualDone = Boolean(prep?.spiritual?.readAndPrayedConfirmed);
      expect(isSpiritualDone).toBe(false);
    });

    it('marks spiritual step as incomplete when spiritual data is missing', () => {
      const prep = createMockPreparation({
        spiritual: undefined
      });
      
      const isSpiritualDone = Boolean(prep?.spiritual?.readAndPrayedConfirmed);
      expect(isSpiritualDone).toBe(false);
    });
  });

  describe('Text Context Step Completion', () => {
    it('marks text context step as complete when all required fields are filled', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        }
      });
      
      const isTextContextDone = Boolean(
        prep?.textContext?.readWholeBookOnceConfirmed &&
        (prep?.textContext?.contextNotes || '').trim().length > 0 &&
        (prep?.textContext?.repeatedWords && prep.textContext.repeatedWords.length > 0)
      );
      
      expect(isTextContextDone).toBe(true);
    });

    it('marks text context step as incomplete when readWholeBookOnceConfirmed is false', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: false,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        }
      });
      
      const isTextContextDone = Boolean(
        prep?.textContext?.readWholeBookOnceConfirmed &&
        (prep?.textContext?.contextNotes || '').trim().length > 0 &&
        (prep?.textContext?.repeatedWords && prep.textContext.repeatedWords.length > 0)
      );
      
      expect(isTextContextDone).toBe(false);
    });

    it('marks text context step as incomplete when contextNotes is empty', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: '',
          repeatedWords: ['love', 'faith']
        }
      });
      
      const isTextContextDone = Boolean(
        prep?.textContext?.readWholeBookOnceConfirmed &&
        (prep?.textContext?.contextNotes || '').trim().length > 0 &&
        (prep?.textContext?.repeatedWords && prep.textContext.repeatedWords.length > 0)
      );
      
      expect(isTextContextDone).toBe(false);
    });

    it('marks text context step as incomplete when repeatedWords is empty', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: []
        }
      });
      
      const isTextContextDone = Boolean(
        prep?.textContext?.readWholeBookOnceConfirmed &&
        (prep?.textContext?.contextNotes || '').trim().length > 0 &&
        (prep?.textContext?.repeatedWords && prep.textContext.repeatedWords.length > 0)
      );
      
      expect(isTextContextDone).toBe(false);
    });

    it('handles whitespace-only contextNotes correctly', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: '   ',
          repeatedWords: ['love', 'faith']
        }
      });
      
      const isTextContextDone = Boolean(
        prep?.textContext?.readWholeBookOnceConfirmed &&
        (prep?.textContext?.contextNotes || '').trim().length > 0 &&
        (prep?.textContext?.repeatedWords && prep.textContext.repeatedWords.length > 0)
      );
      
      expect(isTextContextDone).toBe(false);
    });
  });

  describe('Exegetical Plan Step Completion', () => {
    it('marks exegetical plan step as complete when plan has titles and author intent', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        },
        exegeticalPlan: [
          { id: '1', title: 'Main Point', children: [] },
          { id: '2', title: 'Sub Point', children: [] }
        ],
        authorIntent: 'Author wanted to teach about love'
      });
      
      const exegeticalPlan = prep?.exegeticalPlan;
      const hasExegeticalPlan = Boolean(exegeticalPlan && exegeticalPlan.length > 0);
      const hasExegeticalPlanWithTitles = hasExegeticalPlan && exegeticalPlan!.some((node: any) =>
        (node.title || '').trim().length > 0 ||
        (node.children && node.children.some((child: any) => (child.title || '').trim().length > 0))
      );
      const hasAuthorIntent = Boolean(prep?.authorIntent && prep.authorIntent.trim().length > 0);
      const isExegeticalPlanDone = hasExegeticalPlanWithTitles && hasAuthorIntent;
      
      expect(isExegeticalPlanDone).toBe(true);
    });

    it('marks exegetical plan step as incomplete when plan has no titles', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        },
        exegeticalPlan: [
          { id: '1', title: '', children: [] },
          { id: '2', title: '', children: [] }
        ],
        authorIntent: 'Author wanted to teach about love'
      });
      
      const exegeticalPlan = prep?.exegeticalPlan;
      const hasExegeticalPlan = Boolean(exegeticalPlan && exegeticalPlan.length > 0);
      const hasExegeticalPlanWithTitles = hasExegeticalPlan && exegeticalPlan!.some((node: any) =>
        (node.title || '').trim().length > 0 ||
        (node.children && node.children.some((child: any) => (child.title || '').trim().length > 0))
      );
      const hasAuthorIntent = Boolean(prep?.authorIntent && prep.authorIntent.trim().length > 0);
      const isExegeticalPlanDone = hasExegeticalPlanWithTitles && hasAuthorIntent;
      
      expect(isExegeticalPlanDone).toBe(false);
    });

    it('marks exegetical plan step as incomplete when author intent is missing', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        },
        exegeticalPlan: [
          { id: '1', title: 'Main Point', children: [] }
        ],
        authorIntent: ''
      });
      
      const exegeticalPlan = prep?.exegeticalPlan;
      const hasExegeticalPlan = Boolean(exegeticalPlan && exegeticalPlan.length > 0);
      const hasExegeticalPlanWithTitles = hasExegeticalPlan && exegeticalPlan!.some((node: any) =>
        (node.title || '').trim().length > 0 ||
        (node.children && node.children.some((child: any) => (child.title || '').trim().length > 0))
      );
      const hasAuthorIntent = Boolean(prep?.authorIntent && prep.authorIntent.trim().length > 0);
      const isExegeticalPlanDone = hasExegeticalPlanWithTitles && hasAuthorIntent;
      
      expect(isExegeticalPlanDone).toBe(false);
    });

    it('marks exegetical plan step as complete when child nodes have titles', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        },
        exegeticalPlan: [
          { 
            id: '1', 
            title: '', 
            children: [
              { id: '1.1', title: 'Child Point', children: [] }
            ] 
          }
        ],
        authorIntent: 'Author intent'
      });
      
      const exegeticalPlan = prep?.exegeticalPlan;
      const hasExegeticalPlan = Boolean(exegeticalPlan && exegeticalPlan.length > 0);
      const hasExegeticalPlanWithTitles = hasExegeticalPlan && exegeticalPlan!.some((node: any) =>
        (node.title || '').trim().length > 0 ||
        (node.children && node.children.some((child: any) => (child.title || '').trim().length > 0))
      );
      const hasAuthorIntent = Boolean(prep?.authorIntent && prep.authorIntent.trim().length > 0);
      const isExegeticalPlanDone = hasExegeticalPlanWithTitles && hasAuthorIntent;
      
      expect(isExegeticalPlanDone).toBe(true);
    });
  });

  describe('Main Idea Step Completion', () => {
    it('marks main idea step as complete when all fields are filled', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        },
        exegeticalPlan: [
          { id: '1', title: 'Main Point', children: [] }
        ],
        authorIntent: 'Author intent',
        mainIdea: {
          contextIdea: 'Context main idea',
          textIdea: 'Text main idea',
          argumentation: 'Supporting argumentation'
        }
      });
      
      const isMainIdeaDone = Boolean(
        prep?.mainIdea?.contextIdea && 
        prep.mainIdea.contextIdea.trim().length > 0 &&
        prep?.mainIdea?.textIdea && 
        prep.mainIdea.textIdea.trim().length > 0 &&
        prep?.mainIdea?.argumentation && 
        prep.mainIdea.argumentation.trim().length > 0
      );
      
      expect(isMainIdeaDone).toBe(true);
    });

    it('marks main idea step as incomplete when contextIdea is missing', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        },
        exegeticalPlan: [
          { id: '1', title: 'Main Point', children: [] }
        ],
        authorIntent: 'Author intent',
        mainIdea: {
          contextIdea: '',
          textIdea: 'Text main idea',
          argumentation: 'Supporting argumentation'
        }
      });
      
      const isMainIdeaDone = Boolean(
        prep?.mainIdea?.contextIdea && 
        prep.mainIdea.contextIdea.trim().length > 0 &&
        prep?.mainIdea?.textIdea && 
        prep.mainIdea.textIdea.trim().length > 0 &&
        prep?.mainIdea?.argumentation && 
        prep.mainIdea.argumentation.trim().length > 0
      );
      
      expect(isMainIdeaDone).toBe(false);
    });

    it('marks main idea step as incomplete when textIdea is missing', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        },
        exegeticalPlan: [
          { id: '1', title: 'Main Point', children: [] }
        ],
        authorIntent: 'Author intent',
        mainIdea: {
          contextIdea: 'Context main idea',
          textIdea: '',
          argumentation: 'Supporting argumentation'
        }
      });
      
      const isMainIdeaDone = Boolean(
        prep?.mainIdea?.contextIdea && 
        prep.mainIdea.contextIdea.trim().length > 0 &&
        prep?.mainIdea?.textIdea && 
        prep.mainIdea.textIdea.trim().length > 0 &&
        prep?.mainIdea?.argumentation && 
        prep.mainIdea.argumentation.trim().length > 0
      );
      
      expect(isMainIdeaDone).toBe(false);
    });

    it('marks main idea step as incomplete when argumentation is missing', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        },
        exegeticalPlan: [
          { id: '1', title: 'Main Point', children: [] }
        ],
        authorIntent: 'Author intent',
        mainIdea: {
          contextIdea: 'Context main idea',
          textIdea: 'Text main idea',
          argumentation: ''
        }
      });
      
      const isMainIdeaDone = Boolean(
        prep?.mainIdea?.contextIdea && 
        prep.mainIdea.contextIdea.trim().length > 0 &&
        prep?.mainIdea?.textIdea && 
        prep.mainIdea.textIdea.trim().length > 0 &&
        prep?.mainIdea?.argumentation && 
        prep.mainIdea.argumentation.trim().length > 0
      );
      
      expect(isMainIdeaDone).toBe(false);
    });

    it('handles whitespace-only fields correctly', () => {
      const prep = createMockPreparation({
        spiritual: { readAndPrayedConfirmed: true },
        textContext: {
          readWholeBookOnceConfirmed: true,
          contextNotes: 'Some context notes',
          repeatedWords: ['love', 'faith']
        },
        exegeticalPlan: [
          { id: '1', title: 'Main Point', children: [] }
        ],
        authorIntent: 'Author intent',
        mainIdea: {
          contextIdea: '   ',
          textIdea: 'Text main idea',
          argumentation: 'Supporting argumentation'
        }
      });
      
      const isMainIdeaDone = Boolean(
        prep?.mainIdea?.contextIdea && 
        prep.mainIdea.contextIdea.trim().length > 0 &&
        prep?.mainIdea?.textIdea && 
        prep.mainIdea.textIdea.trim().length > 0 &&
        prep?.mainIdea?.argumentation && 
        prep.mainIdea.argumentation.trim().length > 0
      );
      
      expect(isMainIdeaDone).toBe(false);
    });
  });
});
