// Learn more: https://github.com/testing-library/jest-dom
require('@testing-library/jest-dom');

// Ensure React is properly available
global.React = require('react');

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