import { formatStudyNoteForCopy, matchesStudyNoteQuery } from '../studyNoteUtils';
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

/**
 * SEARCH BY WHAT A PREACHER REMEMBERS — the note picker on a sermon and the studies list must
 * narrow on the same words, so the matcher lives in one place and is asserted here directly.
 */
describe('matchesStudyNoteQuery', () => {
  const note: StudyNote = {
    id: 'n1',
    userId: 'user1',
    title: 'Wine and wineskins',
    content: 'The old covenant cannot hold the new wine',
    scriptureRefs: [{ id: 'r1', book: 'John', chapter: 2, fromVerse: 1, toVerse: 11 }],
    tags: ['typology', 'grace'],
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    isDraft: false,
    type: 'note',
  };

  beforeEach(() => {
    mockFormatScriptureRef.mockReturnValue('John.2:1-11');
  });

  it('matches nothing typed — an empty query keeps every note', () => {
    expect(matchesStudyNoteQuery(note, [], 'en')).toBe(true);
  });

  it('matches the title, the text and a tag', () => {
    expect(matchesStudyNoteQuery(note, ['wineskins'], 'en')).toBe(true);
    expect(matchesStudyNoteQuery(note, ['covenant'], 'en')).toBe(true);
    expect(matchesStudyNoteQuery(note, ['typology'], 'en')).toBe(true);
  });

  it('matches the reference AS DISPLAYED, so typing what the badge shows finds the note', () => {
    expect(matchesStudyNoteQuery(note, ['john.2'], 'en')).toBe(true);
    expect(mockFormatScriptureRef).toHaveBeenCalledWith(note.scriptureRefs[0], 'en');
  });

  it('requires EVERY token, so a second word narrows instead of widening', () => {
    expect(matchesStudyNoteQuery(note, ['wine', 'typology'], 'en')).toBe(true);
    expect(matchesStudyNoteQuery(note, ['wine', 'absent'], 'en')).toBe(false);
  });

  it('survives a note with no title, tags or refs', () => {
    const bare = { ...note, title: undefined, tags: [], scriptureRefs: [], content: '' } as StudyNote;
    expect(matchesStudyNoteQuery(bare, ['anything'], 'en')).toBe(false);
    expect(matchesStudyNoteQuery(bare, [], 'en')).toBe(true);
  });
});
