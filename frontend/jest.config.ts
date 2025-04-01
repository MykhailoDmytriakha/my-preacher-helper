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
    // Ignore node_modules, but DO transform react-markdown and unified
    '/node_modules/(?!react-markdown|unified)/',
    // Keep the default Next.js pattern for CSS Modules
    '^.+\\.module\\.(css|sass|scss)$',
  ],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config) 