import { getTodayDateOnlyKey, toDateOnlyKey, parseDateOnlyAsLocalDate } from '@/utils/dateOnly';

describe('dateOnly', () => {
    describe('getTodayDateOnlyKey', () => {
        it('returns formatted today date', () => {
            const d = new Date('2024-12-25T12:00:00Z');
            expect(getTodayDateOnlyKey(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('toDateOnlyKey', () => {
        it('returns null for non-string', () => {
            expect(toDateOnlyKey(null)).toBeNull();
            expect(toDateOnlyKey(undefined)).toBeNull();
            expect(toDateOnlyKey(123 as any)).toBeNull();
        });

        it('returns null for empty or whitespace string', () => {
            expect(toDateOnlyKey('')).toBeNull();
            expect(toDateOnlyKey('   ')).toBeNull();
        });

        it('returns input if matches DATE_ONLY_REGEX', () => {
            expect(toDateOnlyKey('2024-05-10')).toBe('2024-05-10');
        });

        it('returns localized date for valid ISO string', () => {
            expect(toDateOnlyKey('2024-05-10T12:00:00.000Z')).toBe('2024-05-10');
        });

        it('returns localized date for other valid date strings', () => {
            const result = toDateOnlyKey('10/12/2024');
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('returns null for invalid date strings', () => {
            expect(toDateOnlyKey('invalid-date')).toBeNull();
        });
    });

    describe('parseDateOnlyAsLocalDate', () => {
        it('returns null for falsy values', () => {
            expect(parseDateOnlyAsLocalDate(null)).toBeNull();
            expect(parseDateOnlyAsLocalDate('')).toBeNull();
        });

        it('returns valid Date for correct YYYY-MM-DD input', () => {
            const d = parseDateOnlyAsLocalDate('2024-05-10');
            expect(d).toBeInstanceOf(Date);
            expect(d?.getFullYear()).toBe(2024);
            expect(d?.getMonth()).toBe(4); // 0-indexed
            expect(d?.getDate()).toBe(10);
        });

        it('returns null if date cannot be parsed correctly', () => {
            // Mock Date to return NaN for this exact test
            const originalDate = global.Date;
            try {
                global.Date = class extends originalDate {
                    constructor(...args: any[]) {
                        if (args.length === 1 && typeof args[0] === 'string' && args[0].startsWith('x')) {
                            super('invalid');
                        } else if (args.length === 1) {
                            super(...args as [string]);
                        } else {
                            super();
                        }
                    }
                } as any;
                expect(parseDateOnlyAsLocalDate('x-invalid')).toBeNull();
            } finally {
                global.Date = originalDate;
            }
        });

        it('returns null if date component parsing becomes invalid', () => {
            // "0000-00-00" matches regex but is an invalid date
            expect(parseDateOnlyAsLocalDate('0000-00-00')).toBeNull();
        });
    });
});
