import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { formatDate } from '@utils/dateFormatter';

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
      // format should not be called for invalid dates due to our new validation
      expect(format).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        'formatDate received invalid date string:',
        'invalid-date'
      );
      (console.error as jest.Mock).mockRestore();
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

    test('handles NaN date object', () => {
      jest.spyOn(console, 'error').mockImplementation();
      // This creates an Invalid Date object
      const invalidDate = new Date('invalid');
      const result = formatDate(invalidDate.toString());
      expect(result).toBe('Invalid date');
      expect(format).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        'formatDate received invalid date string:',
        'Invalid Date'
      );
      (console.error as jest.Mock).mockRestore();
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
}); 
