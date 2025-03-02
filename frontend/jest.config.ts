import type { Config } from '@jest/types'
import nextJest from 'next/jest'

// Use nextJest to configure the Jest environment for Next.js
const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  modulePaths: ['<rootDir>'],
  rootDir: './',
  moduleFileExtensions: [
    'ts',
    'tsx',
    'js',
    'jsx',
    'json',
    'node'
  ],
  moduleNameMapper: {
    // Fix the path mapping to include app/ directory for components and utils
    '^@/(.*)$': '<rootDir>/app/$1',
    '^@components/(.*)$': '<rootDir>/app/components/$1',
    '^@utils/(.*)$': '<rootDir>/app/utils/$1',
    '^@hooks/(.*)$': '<rootDir>/app/hooks/$1',
    '^@locales/(.*)$': '<rootDir>/locales/$1',
    '^@services/(.*)$': '<rootDir>/app/services/$1',
    '^@styles/(.*)$': '<rootDir>/app/styles/$1',
    '^@context/(.*)$': '<rootDir>/app/context/$1',
    '^@pages/(.*)$': '<rootDir>/app/pages/$1',
    '^@models/(.*)$': '<rootDir>/app/models/$1',
  },
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': 'babel-jest',
  },
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[tj]s?(x)'
  ],
  setupFilesAfterEnv: [
    '<rootDir>/jest.setup.js'
  ],
  testEnvironmentOptions: {
    url: 'http://localhost/'
  },
  collectCoverageFrom: [
    '**/*.{ts,tsx}',
    '!**/node_modules/**',
    '!**/*.d.ts',
    '!**/types/**',
    '!**/.next/**'
  ],
  coverageReporters: [
    "json",
    "lcov",
    "text",
    "text-summary",
    "json-summary"
  ],
  reporters: [
    "default",
    "<rootDir>/test-summary.js"
  ],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config) 