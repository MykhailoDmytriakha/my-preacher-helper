import { formatDate } from '@utils/dateFormatter';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

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
      // Mock format to throw an error
      (format as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid date');
      });
      
      const result = formatDate('invalid-date');
      
      expect(result).toBe('Invalid date');
      expect(format).toHaveBeenCalled();
    });

    test('passes the correct date object to format', () => {
      const dateStr = '2023-01-01T12:00:00Z';
      formatDate(dateStr);
      
      const dateArg = (format as jest.Mock).mock.calls[0][0];
      expect(dateArg).toBeInstanceOf(Date);
      expect(dateArg.toISOString()).toContain('2023-01-01');
    });
  });
}); 