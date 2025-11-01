import 'openai/shims/node';

// Set dummy API keys for OpenAI client initialization during tests
process.env.OPENAI_API_KEY = 'test_key_openai';
process.env.GEMINI_API_KEY = 'test_key_gemini';

// Import Jest DOM utilities
import '@testing-library/jest-dom';
import 'jest-environment-jsdom';
import React from 'react';

// Set React to development mode for better error messages
process.env.NODE_ENV = 'development';

// Polyfill Web Fetch API primitives for Next route tests (Node/Jest)
try {
  const undici = require('undici');
  globalThis.Blob = globalThis.Blob || undici.Blob;
  globalThis.File = globalThis.File || undici.File;
  globalThis.FormData = globalThis.FormData || undici.FormData;
  globalThis.Headers = globalThis.Headers || undici.Headers;
  globalThis.Request = globalThis.Request || undici.Request;
  globalThis.Response = globalThis.Response || undici.Response;
} catch (_) {
  // ignore if undici not available; jsdom may already provide these
}

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

  // Reuse a single portal root per container to avoid duplicate content on re-renders
  const rootsMap = new Map(); // container -> { root, portalElement }

  function ensureRoot(targetContainer) {
    let record = rootsMap.get(targetContainer);
    if (!record || !record.portalElement || !record.portalElement.isConnected) {
      const portalElement = document.createElement('div');
      portalElement.setAttribute('data-testid', 'portal-content');
      targetContainer.appendChild(portalElement);
      const root = clientModule.createRoot(portalElement);
      record = { root, portalElement };
      rootsMap.set(targetContainer, record);
    }
    return record;
  }

  const PortalWrapper = ({ children, container }) => {
    const targetContainer = container || portalRoot;

    React.useEffect(() => {
      const record = ensureRoot(targetContainer);
      record.root.render(children);
      return () => {
        const rec = rootsMap.get(targetContainer);
        if (rec) {
          try { rec.root.unmount(); } catch {}
          if (rec.portalElement && rec.portalElement.parentNode) {
            rec.portalElement.parentNode.removeChild(rec.portalElement);
          }
          rootsMap.delete(targetContainer);
        }
      };
    }, [children, targetContainer]);

    // Render a lightweight marker into the normal tree
    return React.createElement('div', { 'data-testid': 'portal-wrapper', className: 'portal-wrapper' }, null);
  };

  const mockCreatePortal = (children, container) => React.createElement(PortalWrapper, { children, container });

  return {
    ...originalModule,
    createPortal: mockCreatePortal,
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

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  usePathname: jest.fn().mockReturnValue('/'),
  useParams: jest.fn().mockReturnValue({ id: 'test-sermon-id' }),
  useSearchParams: jest.fn().mockReturnValue({
    get: jest.fn(),
    toString: jest.fn(),
  }),
  useRouter: () => ({
    route: '/',
    pathname: '',
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
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
        language: 'en',
      },
    };
  },
  initReactI18next: {
    type: '3rdParty',
    init: jest.fn(),
  },
}));

// Mock base i18next module to avoid initialization errors in tests
jest.mock('i18next', () => {
  const mockInstance = {
    use: () => mockInstance, // Return instance for chaining
    init: jest.fn(),
    t: (key) => key, // Simple pass-through translation mock
    changeLanguage: jest.fn(),
    language: 'en', // Default language for tests
    // Add any other methods needed by your components
  };

  return {
    // Keep existing mocks
    use: () => mockInstance, 
    init: jest.fn(),
    t: (key) => key,
    changeLanguage: jest.fn(),
    language: 'en',
    // Add the createInstance mock
    createInstance: jest.fn(() => mockInstance), 
  };
});

// Mock i18n module - REMOVED as it conflicts with react-i18next mock
// jest.mock('@locales/i18n', () => {}, { virtual: true }); 

// Mock Firebase auth to avoid API key issues during tests
jest.mock('firebase/auth', () => {
  const mockUser = {
    uid: 'test-user-id',
    email: 'test@example.com',
    displayName: 'Test User',
    metadata: {
      creationTime: new Date().toISOString()
    },
    isAnonymous: false
  };

  // Mock auth object that includes currentUser and properly implemented onAuthStateChanged
  const mockAuth = {
    currentUser: mockUser,
    onAuthStateChanged: jest.fn((auth, callback) => {
      // Immediately fire the callback with the mock user
      callback(mockUser);
      // Return mock unsubscribe function
      return jest.fn();
    })
  };

  return {
    getAuth: jest.fn().mockReturnValue(mockAuth),
    signInWithPopup: jest.fn().mockResolvedValue({ user: mockUser }),
    GoogleAuthProvider: jest.fn(() => ({ 
      providerId: 'google.com',
      addScope: jest.fn()
    })),
    signOut: jest.fn().mockResolvedValue(undefined),
    onAuthStateChanged: jest.fn((auth, callback) => {
      // Immediately fire the callback with the mock user
      callback(mockUser);
      // Return mock unsubscribe function
      return jest.fn();
    }),
    createUserWithEmailAndPassword: jest.fn().mockResolvedValue({ user: mockUser }),
    signInWithEmailAndPassword: jest.fn().mockResolvedValue({ user: mockUser }),
    setPersistence: jest.fn(),
    browserLocalPersistence: 'local',
    signInAnonymously: jest.fn().mockResolvedValue({ user: {...mockUser, isAnonymous: true} })
  };
});

// Mock Firebase auth service with a proper auth object
jest.mock('@/services/firebaseAuth.service', () => {
  const mockUser = {
    uid: 'test-user-id',
    email: 'test@example.com',
    displayName: 'Test User',
    metadata: {
      creationTime: new Date().toISOString()
    },
    isAnonymous: false
  };

  return {
    auth: {
      currentUser: mockUser,
      onAuthStateChanged: jest.fn((callback) => {
        // Immediately fire the callback with the mock user
        callback(mockUser);
        // Return mock unsubscribe function
        return jest.fn();
      })
    },
    signInWithGoogle: jest.fn().mockResolvedValue(mockUser),
    logOut: jest.fn().mockResolvedValue(undefined),
    signInAsGuest: jest.fn().mockResolvedValue({...mockUser, isAnonymous: true}),
    checkGuestExpiration: jest.fn().mockReturnValue(true)
  };
});

// Mock Firebase app
jest.mock('firebase/app', () => {
  const app = {
    initializeApp: jest.fn().mockReturnValue({}),
    getApps: jest.fn().mockReturnValue([]),
  };
  return app;
});

// Mock Firebase Firestore
jest.mock('firebase/firestore', () => {
  return {
    getFirestore: jest.fn().mockReturnValue({}),
    collection: jest.fn(),
    doc: jest.fn(),
    getDocs: jest.fn(),
    getDoc: jest.fn(),
    setDoc: jest.fn(),
    addDoc: jest.fn(),
    deleteDoc: jest.fn(),
    updateDoc: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    onSnapshot: jest.fn(),
    Timestamp: {
      now: jest.fn().mockReturnValue({ toDate: jest.fn() }),
      fromDate: jest.fn().mockReturnValue({}),
    }
  };
});

// Mock react-markdown to avoid ESM module issues
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="markdown">{children}</div>
}));

// Mock remark-gfm
jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: {}
})); 

// Mock Next.js Image component to avoid hostname configuration issues in tests
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, width, height, className, ...props }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return React.createElement('img', {
      src,
      alt,
      width,
      height,
      className,
      ...props,
      'data-testid': 'next-image'
    });
  }
})); 
