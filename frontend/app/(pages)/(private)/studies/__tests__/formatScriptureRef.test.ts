/**
 * Tests for formatScriptureRef function
 *
 * These tests verify the formatting of flexible Scripture reference types:
 * - Book only
 * - Chapter only
 * - Chapter range
 * - Verse
 * - Verse range
 */
import { formatScriptureRef } from '../bookAbbreviations';

describe('formatScriptureRef', () => {
    describe('book-only references', () => {
        it('should format book-only reference without locale', () => {
            expect(formatScriptureRef({ book: 'Ezekiel' })).toBe('Иез');
        });

        it('should format book-only reference with Russian locale', () => {
            expect(formatScriptureRef({ book: 'Matthew' }, 'ru')).toBe('Мф');
        });

        it('should format book-only reference with Ukrainian locale', () => {
            expect(formatScriptureRef({ book: 'Matthew' }, 'uk')).toBe('Мт');
        });

        it('should format book-only reference with English locale', () => {
            expect(formatScriptureRef({ book: 'Matthew' }, 'en')).toBe('Matt');
        });
    });

    describe('chapter-only references', () => {
        it('should format chapter-only reference', () => {
            expect(formatScriptureRef({ book: 'Romans', chapter: 8 })).toBe('Рим.8');
        });

        it('should format chapter-only reference with Russian locale', () => {
            expect(formatScriptureRef({ book: 'Romans', chapter: 8 }, 'ru')).toBe('Рим.8');
        });

        it('should format chapter-only reference with English locale', () => {
            expect(formatScriptureRef({ book: 'Romans', chapter: 8 }, 'en')).toBe('Rom.8');
        });

        it('should ignore redundant toChapter equal to chapter', () => {
            expect(formatScriptureRef({ book: 'Hebrews', chapter: 10, toChapter: 10 })).toBe('Евр.10');
        });

        it('should convert Psalm chapter from Hebrew to Septuagint for Russian', () => {
            // Psalm 23 (Hebrew) -> Psalm 22 (Septuagint)
            expect(formatScriptureRef({ book: 'Psalms', chapter: 23 }, 'ru')).toBe('Пс.22');
        });

        it('should keep Psalm chapter as-is for English', () => {
            expect(formatScriptureRef({ book: 'Psalms', chapter: 23 }, 'en')).toBe('Ps.23');
        });
    });

    describe('chapter-range references', () => {
        it('should format chapter range', () => {
            expect(formatScriptureRef({ book: 'Matthew', chapter: 5, toChapter: 7 })).toBe('Мф.5-7');
        });

        it('should format chapter range with English locale', () => {
            expect(formatScriptureRef({ book: 'Matthew', chapter: 5, toChapter: 7 }, 'en')).toBe('Matt.5-7');
        });

        it('should convert Psalm chapter range from Hebrew to Septuagint for Russian', () => {
            // Psalm 23-25 (Hebrew) -> Psalm 22-24 (Septuagint)
            expect(formatScriptureRef({ book: 'Psalms', chapter: 23, toChapter: 25 }, 'ru')).toBe('Пс.22-24');
        });

        it('should format Ezekiel chapter range for temple vision', () => {
            expect(formatScriptureRef({ book: 'Ezekiel', chapter: 40, toChapter: 48 }, 'ru')).toBe('Иез.40-48');
        });
    });

    describe('verse references', () => {
        it('should format single verse', () => {
            expect(formatScriptureRef({ book: 'John', chapter: 3, fromVerse: 16 })).toBe('Ин.3:16');
        });

        it('should format single verse with English locale', () => {
            expect(formatScriptureRef({ book: 'John', chapter: 3, fromVerse: 16 }, 'en')).toBe('John.3:16');
        });

        it('should format verse when redundant toChapter is present', () => {
            expect(formatScriptureRef({ book: 'Hebrews', chapter: 10, toChapter: 10, fromVerse: 22 })).toBe('Евр.10:22');
        });

        it('should convert Psalm with verse from Hebrew to Septuagint', () => {
            // Psalm 23:1 (Hebrew) -> Psalm 22:1 (Septuagint)
            expect(formatScriptureRef({ book: 'Psalms', chapter: 23, fromVerse: 1 }, 'ru')).toBe('Пс.22:1');
        });
    });

    describe('verse-range references', () => {
        it('should format verse range', () => {
            expect(formatScriptureRef({
                book: 'Isaiah',
                chapter: 4,
                fromVerse: 5,
                toVerse: 8,
            })).toBe('Ис.4:5-8');
        });

        it('should format verse range with English locale', () => {
            expect(formatScriptureRef({
                book: 'Isaiah',
                chapter: 4,
                fromVerse: 5,
                toVerse: 8,
            }, 'en')).toBe('Isa.4:5-8');
        });

        it('should format single verse when toVerse equals fromVerse', () => {
            expect(formatScriptureRef({
                book: 'John',
                chapter: 3,
                fromVerse: 16,
                toVerse: 16,
            })).toBe('Ин.3:16');
        });

        it('should format Beatitudes reference', () => {
            expect(formatScriptureRef({
                book: 'Matthew',
                chapter: 5,
                fromVerse: 3,
                toVerse: 12,
            }, 'ru')).toBe('Мф.5:3-12');
        });
    });

    describe('edge cases', () => {
        it('should handle unknown book by using book name as-is', () => {
            expect(formatScriptureRef({ book: 'UnknownBook', chapter: 1 })).toBe('UnknownBook.1');
        });

        it('should handle 1 Corinthians (book with number prefix)', () => {
            expect(formatScriptureRef({
                book: '1 Corinthians',
                chapter: 13,
                fromVerse: 4,
                toVerse: 8,
            }, 'ru')).toBe('1Кор.13:4-8');
        });

        it('should handle Song of Solomon', () => {
            expect(formatScriptureRef({
                book: 'Song of Solomon',
                chapter: 1,
                fromVerse: 1,
            }, 'ru')).toBe('Песн.1:1');
        });

        it('should handle Revelation', () => {
            expect(formatScriptureRef({
                book: 'Revelation',
                chapter: 13,
                fromVerse: 18,
            }, 'ru')).toBe('Откр.13:18');
        });
    });
});
