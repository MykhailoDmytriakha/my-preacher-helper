import { getNoteModalWidth } from '../constants';

describe('studies constants utils', () => {
    describe('getNoteModalWidth', () => {
        it('returns max-w-2xl for short content', () => {
            expect(getNoteModalWidth(100)).toBe('max-w-2xl');
            expect(getNoteModalWidth(500)).toBe('max-w-2xl');
        });

        it('returns max-w-3xl for medium-short content', () => {
            expect(getNoteModalWidth(501)).toBe('max-w-3xl');
            expect(getNoteModalWidth(1000)).toBe('max-w-3xl');
        });

        it('returns max-w-4xl for medium-long content', () => {
            expect(getNoteModalWidth(1001)).toBe('max-w-4xl');
            expect(getNoteModalWidth(2000)).toBe('max-w-4xl');
        });

        it('returns max-w-5xl for very long content', () => {
            expect(getNoteModalWidth(2001)).toBe('max-w-5xl');
            expect(getNoteModalWidth(10000)).toBe('max-w-5xl');
        });
    });
});
