// Import Jest DOM utilities
import '@testing-library/jest-dom';
import 'jest-environment-jsdom';
import React from 'react';

// Set React to development mode for better error messages
process.env.NODE_ENV = 'development';

// Create a portal root element where portal content will be rendered
const portalRoot = document.createElement('div');
portalRoot.setAttribute('id', 'portal-root');
document.body.appendChild(portalRoot);

// Store original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};

// Only show console output if JEST_SHOW_LOGS environment variable is set
const shouldShowLogs = process.env.JEST_SHOW_LOGS === 'true';

// We need to allow tests to temporarily replace console methods for assertions
// while still providing the clean output capabilities
// Track if a test has overridden the console methods
global.__CONSOLE_OVERRIDDEN_BY_TEST__ = false;

// Replace console methods with no-op or filtered versions
if (!shouldShowLogs) {
  // For each console method, check if it's been overridden by a test
  const createConsoleMock = (method, originalMethod) => {
    return (...args) => {
      // If test has explicitly overridden the console method, respect that
      if (global.__CONSOLE_OVERRIDDEN_BY_TEST__) {
        return;
      }
      
      // Otherwise use the silent implementation
      if (shouldShowLogs) {
        originalMethod(...args);
      }
    };
  };
  
  console.log = createConsoleMock('log', originalConsole.log);
  console.error = createConsoleMock('error', originalConsole.error);
  console.warn = createConsoleMock('warn', originalConsole.warn);
  console.info = createConsoleMock('info', originalConsole.info);
  console.debug = createConsoleMock('debug', originalConsole.debug);
}

// When a test overrides console.error or other methods, it should call this first
beforeEach(() => {
  global.__CONSOLE_OVERRIDDEN_BY_TEST__ = false;
});

// Restore console after tests
afterEach(() => {
  // If a test has overridden the console methods, restore them after the test
  if (global.__CONSOLE_OVERRIDDEN_BY_TEST__) {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
    global.__CONSOLE_OVERRIDDEN_BY_TEST__ = false;
  }
});

// Final cleanup after all tests
afterAll(() => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;
});

// Mock for React 18's createRoot API
jest.mock('react-dom/client', () => {
  // Store created roots to avoid recreating them
  const rootsMap = new Map();
  
  return {
    createRoot: (container) => {
      // Ensure we have a valid container for createRoot
      let validContainer = container;
      if (!container || typeof container.appendChild !== 'function') {
        // If container is invalid, create a new div to use as container
        console.warn('Invalid container provided to createRoot, creating a fallback container');
        validContainer = document.createElement('div');
        document.body.appendChild(validContainer);
      }

      // Check if a root already exists for this container
      if (rootsMap.has(validContainer)) {
        return rootsMap.get(validContainer);
      }

      // Use React 18's ReactDOM to create an actual root
      const ReactDOMClient = jest.requireActual('react-dom/client');
      const root = ReactDOMClient.createRoot(validContainer);
      
      // Store the root for reuse
      const mockRoot = {
        render: (element) => {
          root.render(element);
        },
        unmount: () => {
          root.unmount();
          // Remove from roots map after unmounting
          rootsMap.delete(validContainer);
        }
      };
      
      rootsMap.set(validContainer, mockRoot);
      return mockRoot;
    }
  };
});

// Mock for React's createPortal - helps testing-library find portal content
jest.mock('react-dom', () => {
  const originalModule = jest.requireActual('react-dom');
  const clientModule = jest.requireActual('react-dom/client');
  
  // Create a mock implementation that renders children directly to the DOM
  // This is needed for older versions of testing-library
  const mockCreatePortal = (children, container) => {
    // For testing, we'll render the children directly to the container
    // or to the portal root if no container is provided
    const targetContainer = container || portalRoot;
    
    // Wrap children in a div with a data attribute for easier querying
    const portalElement = document.createElement('div');
    portalElement.setAttribute('data-testid', 'portal-content');
    targetContainer.appendChild(portalElement);
    
    // Use React 18's createRoot to render the children into the portal element
    const root = clientModule.createRoot(portalElement);
    root.render(children);
    
    // Return a React element that represents the portal
    return React.createElement('div', { 
      'data-testid': 'portal-wrapper',
      className: 'portal-wrapper'
    }, null);
  };
  
  return {
    ...originalModule,
    createPortal: mockCreatePortal,
    // Add a legacy render method for backward compatibility with testing-library
    render: (element, container) => {
      const root = clientModule.createRoot(container);
      root.render(element);
      return {
        unmount: () => root.unmount()
      };
    }
  };
});

// Clean up after each test
afterEach(() => {
  // Clear mocks
  jest.clearAllMocks();

  // Reset the body but keep the portal root
  document.body.innerHTML = '';
  document.body.appendChild(portalRoot);
});

// Mock Next.js router
jest.mock('next/router', () => ({
  useRouter: () => ({
    route: '/',
    pathname: '',
    query: {},
    asPath: '',
    push: jest.fn(),
    replace: jest.fn(),
    reload: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
    beforePopState: jest.fn(),
    events: {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    },
    isFallback: false,
  }),
}));

// Mock i18next for translations
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key) => {
        // Provide translations for keys used in the ExportButtons component
        const translations = {
          'export.txtTitle': 'Export as Text',
          'export.copy': 'Copy to Clipboard',
          'export.copied': 'Copied!',
          'export.downloadTxt': 'Download as TXT',
          'export.prepareError': 'Error preparing export',
          'export.soonAvailable': 'Coming soon',
        };
        return translations[key] || key;
      },
      i18n: {
        changeLanguage: jest.fn(),
      },
    };
  },
  initReactI18next: {
    type: '3rdParty',
    init: jest.fn(),
  },
}));

// Mock i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true }); 