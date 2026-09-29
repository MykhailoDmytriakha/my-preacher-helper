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
  /*
   * Above the 4 s an async expectation may wait (`configure({ asyncUtilTimeout })` in
   * jest.setup.js), so a starved expectation reports ITSELF rather than being cut off by the
   * test timeout with no useful message. The old value said 5 s while its comment said 15.
   */
  testTimeout: 15000,
  // Performance optimizations
  maxWorkers: '50%', // Use 50% of available cores for better performance
  cache: true, // Enable caching for faster subsequent runs
  // Vercel restores .next/cache between deployments. Jest's own cache keys
  // include source/config/transform state, so reuse is fast but still fail-safe.
  cacheDirectory: '<rootDir>/.next/cache/jest',
  detectOpenHandles: false, // Disable open handle detection for faster tests
  forceExit: false, // Don't force exit to allow proper cleanup
  clearMocks: true, // Clear mocks between tests for consistency
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  modulePaths: ['.', '..'],
  moduleDirectories: ['node_modules', '../node_modules'],
  moduleNameMapper: {
    // Jest 29 does not resolve music-metadata's ESM-only conditional export.
    // Mapping the installed entry keeps the default setup mock working while
    // allowing parser integration tests to explicitly jest.unmock it.
    '^music-metadata$': '<rootDir>/node_modules/music-metadata/lib/index.js',
    '^file-type$': '<rootDir>/node_modules/file-type/index.js',
    // Two aria-query copies are installed: 5.3.0 pinned inside @testing-library/dom and 5.3.2
    // on top for jest-dom (range ^5.0.0). Every test file loaded both role tables. Point
    // jest-dom at the pinned copy so each file loads one. If a dependency update removes this
    // nested path, Jest stops before any test with "Could not locate module": delete this line.
    '^aria-query$': '<rootDir>/node_modules/@testing-library/dom/node_modules/aria-query',
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
    // Shared fake IndexedDB helper; its behavior is covered by storage tests.
    '<rootDir>/app/data-engine/__tests__/storageHarness\\.ts$',
    // Static-analysis and repository fixtures are imported by tests, not test suites.
    '<rootDir>/__tests__/architecture/firestoreBoundary\\.ts$',
    '<rootDir>/__tests__/api/repositories/legacyRepositoryFixture\\.ts$',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    // Types-only contracts: no runtime behavior to validate via coverage.
    '<rootDir>/app/models/models\\.ts$',
    '<rootDir>/app/models/optimisticEntities\\.ts$',
    '<rootDir>/app/models/dashboardOptimistic\\.ts$',
    '<rootDir>/app/types/TimerProps\\.ts$',
    '<rootDir>/app/api/clients/planTypes\\.ts$',
    '<rootDir>/app/\\(pages\\)/\\(private\\)/sermons/\\[id\\]/plan/types\\.ts$',
    '<rootDir>/app/components/audio-recorder/types\\.ts$',
    '<rootDir>/app/components/export-buttons/types\\.ts$',
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
    '!app/data-engine/types.ts', // Types-only command, snapshot and transport contracts
    '!app/models/optimisticEntities.ts', // Types-only optimistic entity contracts
    '!app/models/dashboardOptimistic.ts', // Types-only file; no runtime coverage
    '!app/types/TimerProps.ts', // Types-only file; no runtime coverage
    '!app/api/clients/planTypes.ts', // Types-only AI client contracts
    '!app/(pages)/(private)/sermons/[id]/plan/types.ts', // Types-only plan view contracts
    '!app/components/audio-recorder/types.ts', // Types-only recorder contracts
    '!app/components/export-buttons/types.ts', // Types-only export button contracts
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
  // Preserve the measured pre-optimization floor. Build/test acceleration must
  // not silently trade away application coverage in a later change.
  coverageThreshold: {
    global: {
      branches: 77.54,
      functions: 81.17,
      lines: 89.57,
      statements: 89.57,
    },
  },
}

/*
 * `import { format } from 'date-fns'` loads the whole package, and `date-fns/locale` loads every
 * locale in the world (532 modules) for our three. The production build already rewrites these
 * imports to per-function modules (date-fns is in Next's default optimizePackageImports); Jest's
 * SWC transform does the same only when told. A test that mocks date-fns mocks the deep path it
 * uses, e.g. jest.mock('date-fns/format').
 *
 * The first matching pattern wins. Names without a module of their own go back to the package:
 * five aliases that live inside format/lightFormat/parse, and every region locale except enUS
 * (files are `pt-BR.js`, `be-tarask.js`; this SWC fills no capture groups, and `kebabCase` gives
 * `en-us`, which a case-sensitive build machine does not find). Checked for date-fns 4.1.0 against
 * every export with exact-case file names; an upgrade that adds such a name fails as
 * "Cannot find module 'date-fns/<name>'" — add it to the first `date-fns` pattern.
 */
const MODULARIZED_IMPORTS = {
  'date-fns': {
    transform: {
      '^(formatDate|formatters|longFormatters|lightFormatters|parsers)$': 'date-fns',
      '.*': 'date-fns/{{member}}',
    },
    skipDefaultConversion: true,
  },
  'date-fns/locale': {
    transform: {
      '^enUS$': 'date-fns/locale/en-US',
      '^[a-z]+$': 'date-fns/locale/{{member}}',
      '.*': 'date-fns/locale',
    },
    skipDefaultConversion: true,
  },
}

const nextJestConfig = createJestConfig(config)

// createJestConfig resolves asynchronously so next/jest can load the Next.js config first.
const jestConfig = async (): Promise<Config> => {
  const resolved = await nextJestConfig()
  const swc = Object.values(resolved.transform ?? {}).find(
    (entry) => Array.isArray(entry) && String(entry[0]).includes('swc/jest-transformer'),
  )
  if (!Array.isArray(swc)) {
    throw new Error('jest.config.ts: next/jest no longer uses swc/jest-transformer; move MODULARIZED_IMPORTS to its transformer')
  }
  // Next passes its own rules here (lodash, @mui/icons-material); add ours, keep theirs.
  const nextRules = swc[1]?.modularizeImports as Record<string, unknown> | undefined
  swc[1] = { ...swc[1], modularizeImports: { ...nextRules, ...MODULARIZED_IMPORTS } }
  return resolved
}

export default jestConfig
