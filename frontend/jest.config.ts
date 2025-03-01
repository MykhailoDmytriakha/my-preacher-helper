import type { Config } from '@jest/types'

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/app/$1',
    '^@locales/(.*)$': '<rootDir>/locales/$1',
    '^@/locales/(.*)$': '<rootDir>/locales/$1',
    '^@components/(.*)$': '<rootDir>/app/components/$1',
    '^@utils/(.*)$': '<rootDir>/app/utils/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      jsx: 'react'
    }]
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  globals: {}
}

export default config 