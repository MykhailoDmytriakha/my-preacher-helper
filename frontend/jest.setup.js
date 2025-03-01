// Import Jest DOM extensions
require('@testing-library/jest-dom');

// Mock next/navigation hooks
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  })),
  useSearchParams: jest.fn(() => ({
    get: jest.fn(),
  })),
  usePathname: jest.fn(),
})); 