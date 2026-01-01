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
      expect(getContrastColor('#00ff00')).toBe('#000');
    });

    test('handles invalid input gracefully', () => {
      // The function returns white for invalid input
      expect(getContrastColor('')).toBe('#fff');
      expect(getContrastColor('invalid')).toBe('#fff');
      expect(getContrastColor('#12')).toBe('#fff');
      expect(getContrastColor('#1234')).toBe('#fff');
      expect(getContrastColor('#zzzzzz')).toBe('#fff');
    });

    test('handles edge cases properly', () => {
      // Mid grays should choose the higher-contrast color (black)
      expect(getContrastColor('#808080')).toBe('#000');
      expect(getContrastColor('#888888')).toBe('#000');
    });
    
    test('handles 3-character hex colors', () => {
      // Test 3-character hex colors are expanded correctly
      expect(getContrastColor('#000')).toBe('#fff'); // #000 -> #000000 (dark)
      expect(getContrastColor('#fff')).toBe('#000'); // #fff -> #ffffff (light)
      expect(getContrastColor('#f00')).toBe('#000'); // #f00 -> #ff0000 (red)
      expect(getContrastColor('#0f0')).toBe('#000'); // #0f0 -> #00ff00 (green)
    });

    test('handles 6-character hex without hash and uppercase', () => {
      expect(getContrastColor('FFFFFF')).toBe('#000');
      expect(getContrastColor('000000')).toBe('#fff');
      expect(getContrastColor('#ABCDEF')).toBe('#000');
    });
  });
}); 
