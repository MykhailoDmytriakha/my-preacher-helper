import { getTodayDateOnlyKey, isDateOnlyKey, isMissingDay, toDateOnlyKey, toLocalDateOnlyKey, parseDateOnlyAsLocalDate } from '@/utils/dateOnly';

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

describe('toLocalDateOnlyKey — the day a stamp fell on, in the person\'s own clock', () => {
    it('keeps a note written late in the evening on that evening\'s day, not on the UTC day', () => {
        // Local time, whatever zone the test runs in: west of UTC the ISO form is already tomorrow.
        const lateEvening = new Date(2026, 8, 15, 23, 30);
        expect(toLocalDateOnlyKey(lateEvening.toISOString())).toBe('2026-09-15');
    });

    it('lets a date-only string through untouched: it names a day, not an instant', () => {
        expect(toLocalDateOnlyKey('2026-09-06')).toBe('2026-09-06');
    });

    it('answers nothing for nothing', () => {
        expect(toLocalDateOnlyKey(undefined)).toBeNull();
        expect(toLocalDateOnlyKey('   ')).toBeNull();
        expect(toLocalDateOnlyKey('not a date')).toBeNull();
    });

    describe('isDateOnlyKey', () => {
        it('accepts a finished day', () => {
            expect(isDateOnlyKey('2026-09-20')).toBe(true);
            expect(isDateOnlyKey('2024-02-29')).toBe(true);
        });

        it('refuses a day still being typed or one the calendar does not have', () => {
            expect(isDateOnlyKey('')).toBe(false);
            expect(isDateOnlyKey('2026-0')).toBe(false);
            expect(isDateOnlyKey('2026-09-2')).toBe(false);
            expect(isDateOnlyKey('2026-02-31')).toBe(false);
            expect(isDateOnlyKey('2025-02-29')).toBe(false);
            expect(isDateOnlyKey('2026-13-01')).toBe(false);
            expect(isDateOnlyKey('2026-09-20T00:00:00.000Z')).toBe(false);
        });

        it('counts the day instead of asking the device clock', () => {
            expect(isDateOnlyKey('2011-12-30')).toBe(true);
            expect(isDateOnlyKey('0099-01-01')).toBe(true);
            expect(isDateOnlyKey('2000-02-29')).toBe(true);
            expect(isDateOnlyKey('1900-02-29')).toBe(false);
            expect(isDateOnlyKey('0000-01-01')).toBe(false);
        });
    });

    describe('isMissingDay', () => {
        it('names only a day-shaped value that is not a day', () => {
            expect(isMissingDay('2026-02-31')).toBe(true);
            expect(isMissingDay('0000-01-01')).toBe(true);
            expect(isMissingDay('2026-02-28')).toBe(false);
            expect(isMissingDay('2026-1')).toBe(false);
            expect(isMissingDay('')).toBe(false);
        });
    });
});
