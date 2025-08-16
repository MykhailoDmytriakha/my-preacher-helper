import { getInitialLanguage, initializeLanguageFromDB } from '../getInitialLang';
import { getCookieLanguage, getUserLanguage, setLanguageCookie } from '@/services/userSettings.service';
import { getAuth } from 'firebase/auth';
import i18n from '../i18n';

// Mock dependencies
jest.mock('@/services/userSettings.service');
jest.mock('firebase/auth');
jest.mock('../i18n', () => ({
  language: 'en',
  changeLanguage: jest.fn()
}));

const mockGetCookieLanguage = getCookieLanguage as jest.MockedFunction<typeof getCookieLanguage>;
const mockGetUserLanguage = getUserLanguage as jest.MockedFunction<typeof getUserLanguage>;
const mockSetLanguageCookie = setLanguageCookie as jest.MockedFunction<typeof setLanguageCookie>;
const mockGetAuth = getAuth as jest.MockedFunction<typeof getAuth>;
const mockI18n = i18n as jest.Mocked<typeof i18n>;

describe('getInitialLang', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset i18n mock
    mockI18n.language = 'en';
    mockI18n.changeLanguage.mockClear();
  });

  describe('getInitialLanguage', () => {
    it('should return cookie language', () => {
      mockGetCookieLanguage.mockReturnValue('ru');
      
      const result = getInitialLanguage();
      
      expect(result).toBe('ru');
      expect(mockGetCookieLanguage).toHaveBeenCalledTimes(1);
    });

    it('should return default language when cookie is not set', () => {
      mockGetCookieLanguage.mockReturnValue('en');
      
      const result = getInitialLanguage();
      
      expect(result).toBe('en');
      expect(mockGetCookieLanguage).toHaveBeenCalledTimes(1);
    });

    it('should return different language from cookie', () => {
      mockGetCookieLanguage.mockReturnValue('uk');
      
      const result = getInitialLanguage();
      
      expect(result).toBe('uk');
      expect(mockGetCookieLanguage).toHaveBeenCalledTimes(1);
    });
  });

  describe('initializeLanguageFromDB', () => {
    it('should return early when window is undefined (SSR)', async () => {
      const originalWindow = global.window;
      delete (global as any).window;
      
      await initializeLanguageFromDB();
      
      expect(mockGetAuth).not.toHaveBeenCalled();
      expect(mockGetUserLanguage).not.toHaveBeenCalled();
      
      // Restore window
      global.window = originalWindow;
    });

    it('should return early when user is not authenticated', async () => {
      const mockAuth = {
        currentUser: null
      };
      mockGetAuth.mockReturnValue(mockAuth as any);
      
      await initializeLanguageFromDB();
      
      expect(mockGetAuth).toHaveBeenCalledTimes(1);
      expect(mockGetUserLanguage).not.toHaveBeenCalled();
      expect(mockI18n.changeLanguage).not.toHaveBeenCalled();
      expect(mockSetLanguageCookie).not.toHaveBeenCalled();
    });

    it('should update language when database language differs from current', async () => {
      const mockUser = { uid: 'user123' };
      const mockAuth = {
        currentUser: mockUser
      };
      mockGetAuth.mockReturnValue(mockAuth as any);
      mockGetUserLanguage.mockResolvedValue('ru');
      mockI18n.language = 'en';
      
      await initializeLanguageFromDB();
      
      expect(mockGetAuth).toHaveBeenCalledTimes(1);
      expect(mockGetUserLanguage).toHaveBeenCalledWith('user123');
      expect(mockI18n.changeLanguage).toHaveBeenCalledWith('ru');
      expect(mockSetLanguageCookie).toHaveBeenCalledWith('ru');
    });

    it('should not update language when database language is the same as current', async () => {
      const mockUser = { uid: 'user123' };
      const mockAuth = {
        currentUser: mockUser
      };
      mockGetAuth.mockReturnValue(mockAuth as any);
      mockGetUserLanguage.mockResolvedValue('en');
      mockI18n.language = 'en';
      
      await initializeLanguageFromDB();
      
      expect(mockGetAuth).toHaveBeenCalledTimes(1);
      expect(mockGetUserLanguage).toHaveBeenCalledWith('user123');
      expect(mockI18n.changeLanguage).not.toHaveBeenCalled();
      expect(mockSetLanguageCookie).not.toHaveBeenCalled();
    });

    it('should not update language when database language is null/undefined', async () => {
      const mockUser = { uid: 'user123' };
      const mockAuth = {
        currentUser: mockUser
      };
      mockGetAuth.mockReturnValue(mockAuth as any);
      mockGetUserLanguage.mockResolvedValue(null as any);
      mockI18n.language = 'en';
      
      await initializeLanguageFromDB();
      
      expect(mockGetAuth).toHaveBeenCalledTimes(1);
      expect(mockGetUserLanguage).toHaveBeenCalledWith('user123');
      expect(mockI18n.changeLanguage).not.toHaveBeenCalled();
      expect(mockSetLanguageCookie).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully and keep using current language', async () => {
      const mockUser = { uid: 'user123' };
      const mockAuth = {
        currentUser: mockUser
      };
      mockGetAuth.mockReturnValue(mockAuth as any);
      mockGetUserLanguage.mockRejectedValue(new Error('Database error'));
      mockI18n.language = 'en';
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      await initializeLanguageFromDB();
      
      expect(mockGetAuth).toHaveBeenCalledTimes(1);
      expect(mockGetUserLanguage).toHaveBeenCalledWith('user123');
      expect(mockI18n.changeLanguage).not.toHaveBeenCalled();
      expect(mockSetLanguageCookie).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Error synchronizing language from DB:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should handle different language scenarios', async () => {
      const mockUser = { uid: 'user123' };
      const mockAuth = {
        currentUser: mockUser
      };
      mockGetAuth.mockReturnValue(mockAuth as any);
      mockGetUserLanguage.mockResolvedValue('uk');
      mockI18n.language = 'en';
      
      await initializeLanguageFromDB();
      
      expect(mockGetAuth).toHaveBeenCalledTimes(1);
      expect(mockGetUserLanguage).toHaveBeenCalledWith('user123');
      expect(mockI18n.changeLanguage).toHaveBeenCalledWith('uk');
      expect(mockSetLanguageCookie).toHaveBeenCalledWith('uk');
    });

    it('should handle empty string language from database', async () => {
      const mockUser = { uid: 'user123' };
      const mockAuth = {
        currentUser: mockUser
      };
      mockGetAuth.mockReturnValue(mockAuth as any);
      mockGetUserLanguage.mockResolvedValue('');
      mockI18n.language = 'en';
      
      await initializeLanguageFromDB();
      
      expect(mockGetAuth).toHaveBeenCalledTimes(1);
      expect(mockGetUserLanguage).toHaveBeenCalledWith('user123');
      expect(mockI18n.changeLanguage).not.toHaveBeenCalled();
      expect(mockSetLanguageCookie).not.toHaveBeenCalled();
    });

    it('should handle whitespace-only language from database', async () => {
      const mockUser = { uid: 'user123' };
      const mockAuth = {
        currentUser: mockUser
      };
      mockGetAuth.mockReturnValue(mockAuth as any);
      mockGetUserLanguage.mockResolvedValue('   ');
      mockI18n.language = 'en';
      
      await initializeLanguageFromDB();
      
      expect(mockGetAuth).toHaveBeenCalledTimes(1);
      expect(mockGetUserLanguage).toHaveBeenCalledWith('user123');
      // Whitespace-only strings are truthy in JavaScript, so the function will treat it as a valid language
      expect(mockI18n.changeLanguage).toHaveBeenCalledWith('   ');
      expect(mockSetLanguageCookie).toHaveBeenCalledWith('   ');
    });
  });
});
