import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import {
  formatDate,
  formatDateOnly,
  getTodayDateOnlyKey,
  toDateOnlyKey
} from '@utils/dateFormatter';

// Mock date-fns to control its behavior
jest.mock('date-fns', () => ({
  format: jest.fn(),
}));

jest.mock('date-fns/locale', () => ({
  ru: 'ru-locale-mock',
}));

describe('Date Formatter Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (format as jest.Mock).mockImplementation(() => 'formatted-date');
  });

  describe('formatDate', () => {
    test('formats date correctly', () => {
      const dateStr = '2023-01-01T12:00:00Z';
      const result = formatDate(dateStr);

      expect(format).toHaveBeenCalledWith(
        expect.any(Date),
        'dd.MM.yyyy, HH:mm',
        { locale: ru }
      );
      expect(result).toBe('formatted-date');
    });

    test('handles invalid date gracefully', () => {
      jest.spyOn(console, 'error').mockImplementation();
      const result = formatDate('invalid-date');

      expect(result).toBe('Invalid date');
      expect(format).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        'formatDate received invalid date string:',
        'invalid-date'
      );
      (console.error as jest.Mock).mockRestore();
    });

    test('handles whitespace-only input as invalid value', () => {
      jest.spyOn(console, 'error').mockImplementation();

      const result = formatDate('   ');

      expect(result).toBe('Invalid date');
      expect(format).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        'formatDate received invalid date string:',
        '   '
      );
      (console.error as jest.Mock).mockRestore();
    });

    test('uses local date-only parser branch for YYYY-MM-DD input', () => {
      const result = formatDate('2026-02-15');

      expect(result).toBe('formatted-date');
      expect(format).toHaveBeenCalledWith(
        expect.any(Date),
        'dd.MM.yyyy, HH:mm',
        { locale: ru }
      );
      const usedDate = (format as jest.Mock).mock.calls[0][0] as Date;
      expect(usedDate.getFullYear()).toBe(2026);
      expect(usedDate.getMonth()).toBe(1);
      expect(usedDate.getDate()).toBe(15);
    });

    test('passes the correct date object to format', () => {
      const dateStr = '2023-01-01T12:00:00Z';
      formatDate(dateStr);

      const dateArg = (format as jest.Mock).mock.calls[0][0];
      expect(dateArg).toBeInstanceOf(Date);
      expect(dateArg.toISOString()).toContain('2023-01-01');
    });

    test('handles null input', () => {
      jest.spyOn(console, 'warn').mockImplementation();
      const result = formatDate(null);
      expect(result).toBe('No date');
      expect(format).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        'formatDate received empty date string:',
        null
      );
      (console.warn as jest.Mock).mockRestore();
    });

    test('handles undefined input', () => {
      jest.spyOn(console, 'warn').mockImplementation();
      const result = formatDate(undefined);
      expect(result).toBe('No date');
      expect(format).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        'formatDate received empty date string:',
        undefined
      );
      (console.warn as jest.Mock).mockRestore();
    });

    test('handles empty string input', () => {
      jest.spyOn(console, 'warn').mockImplementation();
      const result = formatDate('');
      expect(result).toBe('No date');
      expect(format).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        'formatDate received empty date string:',
        ''
      );
      (console.warn as jest.Mock).mockRestore();
    });

    test('handles errors thrown by format', () => {
      jest.spyOn(console, 'error').mockImplementation();
      (format as jest.Mock).mockImplementationOnce(() => {
        throw new Error('format failed');
      });

      const result = formatDate('2024-01-01T00:00:00Z');

      expect(result).toBe('Invalid date');
      expect(console.error).toHaveBeenCalledWith(
        'Error formatting date:',
        expect.any(Error),
        'for input:',
        '2024-01-01T00:00:00Z'
      );
      (console.error as jest.Mock).mockRestore();
    });
  });

  describe('formatDateOnly', () => {
    test('formats date-only correctly', () => {
      (format as jest.Mock).mockImplementationOnce(() => 'formatted-date-only');

      const result = formatDateOnly('2026-02-15T00:00:00.000Z');

      expect(format).toHaveBeenCalledWith(
        expect.any(Date),
        'dd.MM.yyyy',
        { locale: ru }
      );
      expect(result).toBe('formatted-date-only');
    });

    test('returns invalid for bad input', () => {
      jest.spyOn(console, 'error').mockImplementation();

      const result = formatDateOnly('not-a-date');

      expect(result).toBe('Invalid date');
      expect(console.error).toHaveBeenCalledWith(
        'formatDateOnly received invalid date string:',
        'not-a-date'
      );
      (console.error as jest.Mock).mockRestore();
    });

    test('returns no date for empty and catches thrown formatter errors', () => {
      jest.spyOn(console, 'warn').mockImplementation();
      jest.spyOn(console, 'error').mockImplementation();

      expect(formatDateOnly('')).toBe('No date');

      (format as jest.Mock).mockImplementationOnce(() => {
        throw new Error('format-only failed');
      });
      expect(formatDateOnly('2026-02-15')).toBe('Invalid date');

      expect(console.error).toHaveBeenCalledWith(
        'Error formatting date-only value:',
        expect.any(Error),
        'for input:',
        '2026-02-15'
      );

      (console.warn as jest.Mock).mockRestore();
      (console.error as jest.Mock).mockRestore();
    });
  });

  describe('toDateOnlyKey', () => {
    test('keeps ISO date-only values untouched', () => {
      expect(toDateOnlyKey('2026-02-15')).toBe('2026-02-15');
    });

    test('normalizes ISO timestamps to date-only key', () => {
      expect(toDateOnlyKey('2026-02-15T00:00:00.000Z')).toBe('2026-02-15');
    });

    test('returns null for invalid values', () => {
      expect(toDateOnlyKey('invalid-date')).toBeNull();
      expect(toDateOnlyKey(undefined)).toBeNull();
    });
  });

  describe('getTodayDateOnlyKey', () => {
    test('formats provided date as local ymd', () => {
      const referenceDate = new Date(2026, 1, 15, 13, 30, 0);
      expect(getTodayDateOnlyKey(referenceDate)).toBe('2026-02-15');
    });
  });
});
