import type { Config } from 'jest'
import nextJest from 'next/jest.js'

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
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  modulePaths: ['.'],
  moduleNameMapper: {
    // Handle module aliases (aligning with tsconfig.json)
    // Specific paths first
    '^@components/(.*)$': '<rootDir>/app/components/$1',
    '^@services/(.*)$': '<rootDir>/app/services/$1',
    '^@repositories/(.*)$': '<rootDir>/app/api/repositories/$1', // Corrected target path
    '^@api/(.*)$': '<rootDir>/app/api/$1',
    '^@clients/(.*)$': '<rootDir>/app/api/clients/$1', // Added from tsconfig
    '^@utils/(.*)$': '<rootDir>/app/utils/$1',
    '^@locales/(.*)$': '<rootDir>/locales/$1',
    // Base path last
    '^@/(.*)$': '<rootDir>/app/$1', // Corrected base path target
  },
  // Tell Jest to transform specific node_modules packages
  transformIgnorePatterns: [
    // Ignore node_modules, but DO transform ESM modules that require transformation
    '/node_modules/(?!react-markdown|unified|remark-.*|micromark|mdast-.*|unist-.*|@?vfile.*|decode-named-character-reference|property-information|comma-separated-tokens|hast-util-.*|space-separated-tokens|bail|character-entities|trough|markdown-table|ccount|html-void-elements|trim-lines|rehype.*|is-plain-obj|hastscript|web-namespaces|zwitch|hast-.*|style-to-object)/',
    // Keep the default Next.js pattern for CSS Modules
    '^.+\\.module\\.(css|sass|scss)$',
  ],
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}', // Include all TS/TSX files in the app directory
    'locales/**/*.{ts,tsx}', // Include files in locales
    '!app/**/*.test.{ts,tsx}', // Exclude test files within app
    '!app/**/*.spec.{ts,tsx}', // Exclude spec files within app
    '!app/**/__tests__/**', // Exclude __tests__ directories within app
    '!app/**/__mocks__/**', // Exclude __mocks__ directories
    '!**/node_modules/**', // Standard exclusion
    '!<rootDir>/app/layout.tsx', // Often excluded as it's hard to test directly
    '!<rootDir>/app/globals.css', // CSS files don't have coverage
    // Add any other specific files/directories you want to exclude
  ],
  // Optional: Add more reporters for different output formats
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config) 