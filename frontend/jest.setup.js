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

// Mock for React 18's createRoot API
jest.mock('react-dom/client', () => ({
  createRoot: (container) => {
    // Ensure we have a valid container for createRoot
    let validContainer = container;
    if (!container || typeof container.appendChild !== 'function') {
      // If container is invalid, create a new div to use as container
      console.warn('Invalid container provided to createRoot, creating a fallback container');
      validContainer = document.createElement('div');
      document.body.appendChild(validContainer);
    }

    return {
      render: (element) => {
        // Use the actual ReactDOM.render for tests
        const ReactDOM = require('react-dom');
        ReactDOM.render(element, validContainer);
      },
      unmount: () => {
        const ReactDOM = require('react-dom');
        ReactDOM.unmountComponentAtNode(validContainer);
        if (validContainer !== container) {
          // Clean up our fallback container if we created one
          validContainer.parentNode?.removeChild(validContainer);
        }
      }
    };
  }
}));

// Mock for React's createPortal - helps testing-library find portal content
jest.mock('react-dom', () => {
  const originalModule = jest.requireActual('react-dom');
  
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
    
    // Use ReactDOM to render the children into the portal element
    originalModule.render(children, portalElement);
    
    // Return a React element that represents the portal
    return React.createElement('div', { 
      'data-testid': 'portal-wrapper',
      className: 'portal-wrapper'
    }, null);
  };
  
  return {
    ...originalModule,
    createPortal: mockCreatePortal
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