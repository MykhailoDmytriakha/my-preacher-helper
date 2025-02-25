import type { Config } from '@jest/types'

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/app/$1',
    '^@locales/(.*)$': '<rootDir>/locales/$1',
    '^@/locales/(.*)$': '<rootDir>/locales/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  }
}

export default config 