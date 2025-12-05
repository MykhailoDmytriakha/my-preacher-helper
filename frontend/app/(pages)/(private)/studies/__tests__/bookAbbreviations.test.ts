import { formatScriptureRef } from '../bookAbbreviations';

describe('formatScriptureRef', () => {
  it('formats Psalms using locale-specific numbering for ru', () => {
    const formatted = formatScriptureRef(
      {
        book: 'Psalms',
        chapter: 23, // Stored in Hebrew numbering
        fromVerse: 1,
      },
      'ru'
    );

    expect(formatted).toBe('Пс.22:1'); // Displayed in Septuagint numbering
  });

  it('uses localized abbreviation and verse range for non-Psalm books', () => {
    const formatted = formatScriptureRef(
      {
        book: 'Isaiah',
        chapter: 4,
        fromVerse: 5,
        toVerse: 8,
      },
      'en'
    );

    expect(formatted).toBe('Isa.4:5-8');
  });

  it('omits range when toVerse matches fromVerse', () => {
    const formatted = formatScriptureRef({
      book: 'John',
      chapter: 3,
      fromVerse: 16,
      toVerse: 16,
    });

    expect(formatted).toBe('Ин.3:16');
  });
});

