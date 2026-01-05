import { formatStudyNoteForCopy } from '../studyNoteUtils';
import { formatScriptureRef } from '../../(pages)/(private)/studies/bookAbbreviations';
import type { StudyNote } from '@/models/models';

// Mock the bookAbbreviations module
jest.mock('../../(pages)/(private)/studies/bookAbbreviations', () => ({
  formatScriptureRef: jest.fn(),
}));

// Mock the bibleData module
jest.mock('../../(pages)/(private)/studies/bibleData', () => ({
  BibleLocale: {},
}));

const mockFormatScriptureRef = formatScriptureRef as jest.MockedFunction<typeof formatScriptureRef>;

describe('formatStudyNoteForCopy', () => {
  const baseNote: StudyNote = {
    id: '1',
    userId: 'user1',
    content: 'Test content',
    scriptureRefs: [],
    tags: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    isDraft: false,
    type: 'note',
  };

  it('formats note with title and content only', () => {
    const note: StudyNote = {
      ...baseNote,
      title: 'Test Title',
      content: 'Test content',
    };

    const result = formatStudyNoteForCopy(note, 'en');

    expect(result).toBe('# Test Title\n\nTest content');
  });

  it('formats note with content only (no title)', () => {
    const note: StudyNote = {
      ...baseNote,
      title: undefined,
      content: 'Test content',
    };

    const result = formatStudyNoteForCopy(note, 'en');

    expect(result).toBe('Test content');
  });

  it('formats note with scripture references in English', () => {
    mockFormatScriptureRef
      .mockReturnValueOnce('John.3:16')
      .mockReturnValueOnce('Rom.8');

    const note: StudyNote = {
      ...baseNote,
      title: 'Test Title',
      content: 'Test content',
      scriptureRefs: [
        {
          id: '1',
          book: 'John',
          chapter: 3,
          fromVerse: 16,
          toVerse: undefined,
        },
        {
          id: '2',
          book: 'Romans',
          chapter: 8,
          fromVerse: undefined,
          toVerse: undefined,
        },
      ],
    };

    const result = formatStudyNoteForCopy(note, 'en');

    expect(result).toBe('# Test Title\n\nTest content\n\n**Scripture References:**\n- John.3:16\n- Rom.8');
  });

  it('formats note with scripture references in Russian', () => {
    mockFormatScriptureRef
      .mockReturnValueOnce('Ин.3:16')
      .mockReturnValueOnce('Рим.8');

    const note: StudyNote = {
      ...baseNote,
      title: 'Test Title',
      content: 'Test content',
      scriptureRefs: [
        {
          id: '1',
          book: 'John',
          chapter: 3,
          fromVerse: 16,
          toVerse: undefined,
        },
        {
          id: '2',
          book: 'Romans',
          chapter: 8,
          fromVerse: undefined,
          toVerse: undefined,
        },
      ],
    };

    const result = formatStudyNoteForCopy(note, 'ru');

    expect(result).toBe('# Test Title\n\nTest content\n\n**Scripture References:**\n- Ин.3:16\n- Рим.8');
  });

  it('handles Psalm chapter conversion for Russian locale', () => {
    mockFormatScriptureRef.mockReturnValue('Пс.23:1');

    const note: StudyNote = {
      ...baseNote,
      title: 'Psalm Study',
      content: 'Psalm content',
      scriptureRefs: [
        {
          id: '1',
          book: 'Psalms',
          chapter: 23,
          fromVerse: 1,
          toVerse: undefined,
        },
      ],
    };

    const result = formatStudyNoteForCopy(note, 'ru');

    expect(result).toBe('# Psalm Study\n\nPsalm content\n\n**Scripture References:**\n- Пс.23:1');
  });

  it('handles empty scripture references array', () => {
    const note: StudyNote = {
      ...baseNote,
      title: 'Test Title',
      content: 'Test content',
      scriptureRefs: [],
    };

    const result = formatStudyNoteForCopy(note, 'en');

    expect(result).toBe('# Test Title\n\nTest content');
  });

  it('handles note with only title (no content)', () => {
    const note: StudyNote = {
      ...baseNote,
      title: 'Test Title',
      content: '',
      scriptureRefs: [],
    };

    const result = formatStudyNoteForCopy(note, 'en');

    expect(result).toBe('# Test Title');
  });

  it('handles note with only content (no title)', () => {
    const note: StudyNote = {
      ...baseNote,
      title: undefined,
      content: 'Test content',
      scriptureRefs: [],
    };

    const result = formatStudyNoteForCopy(note, 'en');

    expect(result).toBe('Test content');
  });

  it('handles empty note', () => {
    const note: StudyNote = {
      ...baseNote,
      title: undefined,
      content: '',
      scriptureRefs: [],
    };

    const result = formatStudyNoteForCopy(note, 'en');

    expect(result).toBe('');
  });

  it('formats verse ranges correctly', () => {
    mockFormatScriptureRef.mockReturnValue('Matt.5:3-12');

    const note: StudyNote = {
      ...baseNote,
      title: 'Verse Range Test',
      content: 'Content',
      scriptureRefs: [
        {
          id: '1',
          book: 'Matthew',
          chapter: 5,
          fromVerse: 3,
          toVerse: 12,
        },
      ],
    };

    const result = formatStudyNoteForCopy(note, 'en');

    expect(result).toBe('# Verse Range Test\n\nContent\n\n**Scripture References:**\n- Matt.5:3-12');
  });
});
