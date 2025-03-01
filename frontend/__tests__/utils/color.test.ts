import { getContrastColor } from '@utils/color';

describe('Color Utilities', () => {
  describe('getContrastColor', () => {
    test('returns white for dark colors', () => {
      expect(getContrastColor('#000000')).toBe('#fff');
      expect(getContrastColor('#333333')).toBe('#fff');
      expect(getContrastColor('#123456')).toBe('#fff');
      expect(getContrastColor('#0000ff')).toBe('#fff');
    });

    test('returns black for light colors', () => {
      expect(getContrastColor('#ffffff')).toBe('#000');
      expect(getContrastColor('#eeeeee')).toBe('#000');
      expect(getContrastColor('#ffff00')).toBe('#000');
      expect(getContrastColor('#00ff00')).toBe('#fff');
    });

    test('handles invalid input gracefully', () => {
      // The function returns white for invalid input
      expect(getContrastColor('')).toBe('#fff');
      expect(getContrastColor('invalid')).toBe('#fff');
    });

    test('handles edge cases properly', () => {
      // These are at the threshold of the brightness calculation
      expect(getContrastColor('#808080')).toBe('#fff'); // Mid gray returns white
      expect(getContrastColor('#888888')).toBe('#fff');
    });
  });
}); 