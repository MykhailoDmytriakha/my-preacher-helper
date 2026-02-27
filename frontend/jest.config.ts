import nextJest from 'next/jest.js'

import type { Config } from 'jest'

// Use nextJest to configure the Jest environment for Next.js
const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jest-environment-jsdom',
  testTimeout: 5000, // Increase global timeout to 15 seconds
  // Performance optimizations
  maxWorkers: '50%', // Use 50% of available cores for better performance
  cache: true, // Enable caching for faster subsequent runs
  detectOpenHandles: false, // Disable open handle detection for faster tests
  forceExit: false, // Don't force exit to allow proper cleanup
  clearMocks: true, // Clear mocks between tests for consistency
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  modulePaths: ['.', '..'],
  moduleDirectories: ['node_modules', '../node_modules'],
  moduleNameMapper: {
    // Handle module aliases (aligning with tsconfig.json)
    // Specific paths first
    '^@components/(.*)$': '<rootDir>/app/components/$1',
    '^@hooks/(.*)$': '<rootDir>/app/hooks/$1',
    '^@services/(.*)$': '<rootDir>/app/services/$1',
    '^@repositories/(.*)$': '<rootDir>/app/api/repositories/$1', // Corrected target path
    '^@api/(.*)$': '<rootDir>/app/api/$1',
    '^@clients/(.*)$': '<rootDir>/app/api/clients/$1', // Added from tsconfig
    '^@utils/(.*)$': '<rootDir>/app/utils/$1',
    '^@test-utils/(.*)$': '<rootDir>/test-utils/$1',
    '^@locales/(.*)$': '<rootDir>/locales/$1',
    // Base path last
    '^@/(.*)$': '<rootDir>/app/$1', // Corrected base path target
  },
  // Tell Jest to transform specific node_modules packages and root app files
  transformIgnorePatterns: [
    // Ignore node_modules, but DO transform ESM modules that require transformation
    '/node_modules/(?!react-markdown|unified|remark-.*|micromark|mdast-.*|unist-.*|@?vfile.*|decode-named-character-reference|property-information|comma-separated-tokens|hast-util-.*|space-separated-tokens|bail|character-entities|trough|markdown-table|ccount|html-void-elements|trim-lines|rehype.*|is-plain-obj|hastscript|web-namespaces|zwitch|hast-.*|style-to-object|music-metadata|strtok3|peek-readable|token-types|jspdf|fflate|fast-png)/',
    // Keep the default Next.js pattern for CSS Modules
    '^.+\\.module\\.(css|sass|scss)$',
  ],
  // Transform root app directory files
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', {
      presets: [
        ['next/babel'],
      ],
      plugins: [],
    }],
  },
  // Transform files from root app directory as well
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    // Types-only contracts: no runtime behavior to validate via coverage.
    '<rootDir>/app/models/models\\.ts$',
    '<rootDir>/app/models/dashboardOptimistic\\.ts$',
    '<rootDir>/app/types/TimerProps\\.ts$',
    '<rootDir>/app/api/clients/planTypes\\.ts$',
    '<rootDir>/app/\\(pages\\)/\\(private\\)/sermons/\\[id\\]/plan/types\\.ts$',
    // Firebase bootstrap modules are env-driven startup glue, not useful line-coverage targets.
    '<rootDir>/app/config/firebaseConfig\\.ts$',
    '<rootDir>/app/config/firebaseAdminConfig\\.ts$',
    // Next.js route scaffolding is framework shell code; direct coverage is low-signal.
    '<rootDir>/app/layout\\.tsx$',
    '<rootDir>/app/.+/layout\\.tsx$',
    '<rootDir>/app/.+/(loading|template|error|not-found)\\.tsx$',
  ],
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}', // Include all TS/TSX files in the app directory
    'locales/**/*.{ts,tsx}', // Include files in locales
    '!app/**/*.test.{ts,tsx}', // Exclude test files within app
    '!app/**/*.spec.{ts,tsx}', // Exclude spec files within app
    '!app/**/__tests__/**', // Exclude __tests__ directories within app
    '!app/**/__mocks__/**', // Exclude __mocks__ directories
    '!**/node_modules/**', // Standard exclusion
    '!app/models/models.ts', // Types-only file; no runtime coverage
    '!app/models/dashboardOptimistic.ts', // Types-only file; no runtime coverage
    '!app/types/TimerProps.ts', // Types-only file; no runtime coverage
    '!app/api/clients/planTypes.ts', // Types-only AI client contracts
    '!app/(pages)/(private)/sermons/[id]/plan/types.ts', // Types-only plan view contracts
    '!app/config/firebaseConfig.ts', // Bootstrap config; env/init glue
    '!app/config/firebaseAdminConfig.ts', // Bootstrap config; env/init glue
    '!app/layout.tsx', // App shell wrapper; low-signal coverage target
    '!app/**/layout.tsx', // Route shell wrappers; framework scaffolding
    '!app/**/loading.tsx', // Framework loading scaffolding
    '!app/**/template.tsx', // Framework template scaffolding
    '!app/**/error.tsx', // Framework error scaffolding
    '!app/**/not-found.tsx', // Framework not-found scaffolding
    '!<rootDir>/app/globals.css', // CSS files don't have coverage
  ],
  // Optional: Add more reporters for different output formats
  coverageReporters: ['text', 'text-summary', 'json-summary', 'lcov', 'html'],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config) 
