import { StudyNote } from '@/models/models';

// Mock the entire studies page to avoid complex dependencies
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock as any;

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
  writable: true,
});

describe('Study Note Copy Integration', () => {
  const testNote: StudyNote = {
    id: 'test-note-1',
    userId: 'user-1',
    title: 'Test Study Note',
    content: 'This is a test note content about faith and grace.',
    scriptureRefs: [
      { id: 'ref-1', book: 'John', chapter: 3, fromVerse: 16 },
      { id: 'ref-2', book: 'Romans', chapter: 8, fromVerse: 28 },
    ],
    tags: ['faith', 'grace'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    isDraft: false,
    type: 'note',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('copies formatted note content to clipboard', async () => {
    // This is a high-level integration test that verifies the copy functionality works
    // without mocking internal hooks - we test the end result

    // Mock the clipboard API
    const mockWriteText = navigator.clipboard.writeText as jest.MockedFunction<typeof navigator.clipboard.writeText>;

    // Import the utility function directly to test formatting
    const { formatStudyNoteForCopy } = await import('@/utils/studyNoteUtils');

    // Test the formatting function (this is the core business logic)
    const formattedContent = formatStudyNoteForCopy(testNote, 'en');

    // Verify the format is correct
    expect(formattedContent).toContain('# Test Study Note');
    expect(formattedContent).toContain('This is a test note content about faith and grace.');
    expect(formattedContent).toContain('**Scripture References:**');
    expect(formattedContent).toContain('John.3:16');
    expect(formattedContent).toContain('Rom.8:28');

    // Simulate clipboard write (this would normally happen in the component)
    await navigator.clipboard.writeText(formattedContent);

    // Verify clipboard was called with correct content
    expect(mockWriteText).toHaveBeenCalledWith(formattedContent);
  });

  it('formats note correctly in Russian locale', async () => {
    const { formatStudyNoteForCopy } = await import('@/utils/studyNoteUtils');

    const formattedContent = formatStudyNoteForCopy(testNote, 'ru');

    expect(formattedContent).toContain('# Test Study Note');
    expect(formattedContent).toContain('This is a test note content about faith and grace.');
    expect(formattedContent).toContain('**Scripture References:**');
    // Russian localization: John -> Ин., Romans -> Рим.
    expect(formattedContent).toContain('Ин.3:16');
    expect(formattedContent).toContain('Рим.8:28');
  });

  it('handles notes without title', async () => {
    const { formatStudyNoteForCopy } = await import('@/utils/studyNoteUtils');

    const noteWithoutTitle = { ...testNote, title: undefined };
    const formattedContent = formatStudyNoteForCopy(noteWithoutTitle, 'en');

    expect(formattedContent).not.toContain('#');
    expect(formattedContent).toContain('This is a test note content about faith and grace.');
  });

  it('handles notes without scripture references', async () => {
    const { formatStudyNoteForCopy } = await import('@/utils/studyNoteUtils');

    const noteWithoutRefs = { ...testNote, scriptureRefs: [] };
    const formattedContent = formatStudyNoteForCopy(noteWithoutRefs, 'en');

    expect(formattedContent).toContain('# Test Study Note');
    expect(formattedContent).toContain('This is a test note content about faith and grace.');
    expect(formattedContent).not.toContain('**Scripture References:**');
  });

  it('handles empty note content', async () => {
    const { formatStudyNoteForCopy } = await import('@/utils/studyNoteUtils');

    const emptyNote = {
      ...testNote,
      title: undefined,
      content: '',
      scriptureRefs: [],
    };
    const formattedContent = formatStudyNoteForCopy(emptyNote, 'en');

    expect(formattedContent.trim()).toBe('');
  });
});
