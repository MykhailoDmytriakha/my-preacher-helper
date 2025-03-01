// Learn more: https://github.com/testing-library/jest-dom
require('@testing-library/jest-dom');

// Ensure React is properly available in development mode
// If React 18+ is being used, add special configuration for testing environment
global.React = require('react');

// Force React to use development mode for testing
// This ensures act() and other testing functions are available
if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
  process.env.NODE_ENV = 'development';
}

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
  }),
  usePathname: () => '/',
  useParams: () => ({}),
}));

// Mock i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key, options) => {
        if (options && typeof options === 'object') {
          // Handle template substitution for options
          let text = key;
          Object.keys(options).forEach(optionKey => {
            text = text.replace(`{{${optionKey}}}`, options[optionKey]);
          });
          return text;
        }
        return key;
      },
      i18n: {
        changeLanguage: jest.fn(),
      },
    };
  },
}));

// Mock i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true }); 