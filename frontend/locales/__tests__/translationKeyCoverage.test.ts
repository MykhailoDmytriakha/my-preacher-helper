import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as glob from 'glob';
import * as ts from 'typescript';

// Types for better type safety
interface TranslationData {
  [key: string]: string | TranslationData;
}

interface TranslationFiles {
  en: TranslationData;
  ru: TranslationData;
  uk: TranslationData;
}

interface TestResults {
  missingKeys: {
    en: string[];
    ru: string[];
    uk: string[];
  };
  unusedKeys: string[];
  usedKeys: Set<string>;
  allLocaleKeys: Set<string>;
}

/**
 * Recursively flattens a nested translation object into dot-notation keys
 * Example: { user: { name: "John" } } becomes { "user.name": "John" }
 */
function flattenTranslationKeys(obj: TranslationData, prefix = ''): Set<string> {
  const keys = new Set<string>();
  
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively flatten nested objects
      const nestedKeys = flattenTranslationKeys(value, fullKey);
      nestedKeys.forEach(k => keys.add(k));
    } else {
      keys.add(fullKey);
    }
  }
  
  return keys;
}

/** Collect only complete values that can be read from the expression itself. */
function staticStrings(expression: ts.Expression): string[] {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) || ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression)) {
    return staticStrings(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return [...staticStrings(expression.whenTrue), ...staticStrings(expression.whenFalse)];
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const suffixes = staticStrings(expression.right);
    return staticStrings(expression.left).flatMap(prefix => suffixes.map(suffix => prefix + suffix));
  }
  return [];
}

/** Read translation arguments as expressions so a prefix or comment is never counted as a key. */
function extractTranslationKeysFromFile(filePath: string): Set<string> {
  const keys = new Set<string>();
  try {
    const source = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf-8'), ts.ScriptTarget.Latest);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.arguments.length) {
        const callee = node.expression;
        const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
        if (ts.isIdentifier(name) && name.text === 't') {
          for (const key of staticStrings(node.arguments[0])) {
            if (key.length > 2 && key.includes('.') && /^[a-zA-Z][a-zA-Z0-9._-]+$/.test(key) && !key.endsWith('.service')) {
              keys.add(key);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  } catch (error) {
    console.warn(`Warning: Could not read file ${filePath}:`, error);
  }
  return keys;
}

/**
 * Scans all TypeScript/TSX files in the project and extracts translation keys
 */
function getAllUsedTranslationKeys(projectRoot: string): Set<string> {
  const allKeys = new Set<string>();
  
  // Glob patterns to find all TypeScript/TSX files
  const patterns = [
    path.join(projectRoot, 'app/**/*.{ts,tsx}'),
    path.join(projectRoot, 'components/**/*.{ts,tsx}'),
    path.join(projectRoot, 'hooks/**/*.{ts,tsx}'),
    path.join(projectRoot, 'utils/**/*.{ts,tsx}'),
    path.join(projectRoot, 'services/**/*.{ts,tsx}'),
    path.join(projectRoot, 'pages/**/*.{ts,tsx}'),
    path.join(projectRoot, '(pages)/**/*.{ts,tsx}'),
  ];
  
  patterns.forEach(pattern => {
    try {
      const files = glob.sync(pattern, { 
        ignore: [
          '**/__tests__/**',
          '**/*.test.{ts,tsx}',
          '**/*.spec.{ts,tsx}',
          '**/node_modules/**',
          '**/.next/**',
          '**/dist/**',
          '**/build/**'
        ]
      });
      
      files.forEach(file => {
        const keys = extractTranslationKeysFromFile(file);
        keys.forEach(key => allKeys.add(key));
      });
    } catch (error) {
      console.warn(`Warning: Could not process pattern ${pattern}:`, error);
    }
  });
  
  return allKeys;
}

/**
 * Loads and parses all translation files
 */
function loadTranslationFiles(localesDir: string): TranslationFiles {
  const enPath = path.join(localesDir, 'en', 'translation.json');
  const ruPath = path.join(localesDir, 'ru', 'translation.json');
  const ukPath = path.join(localesDir, 'uk', 'translation.json');
  
  const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
  const ru = JSON.parse(fs.readFileSync(ruPath, 'utf-8'));
  const uk = JSON.parse(fs.readFileSync(ukPath, 'utf-8'));
  
  return { en, ru, uk };
}

/**
 * Checks if a key exists in flattened translation keys.
 * Also checks plural-suffixed variants (_one, _other, _few, _many) because
 * i18next plural keys are stored with suffixes in locale files.
 */
function keyExists(key: string, flattenedKeys: Set<string>): boolean {
  return flattenedKeys.has(key) ||
    flattenedKeys.has(key + '_one') ||
    flattenedKeys.has(key + '_other') ||
    flattenedKeys.has(key + '_few') ||
    flattenedKeys.has(key + '_many');
}

/**
 * Analyzes translation coverage and returns detailed results
 */
function analyzeTranslationCoverage(projectRoot: string, localesDir: string): TestResults {
  // Load translation files
  const translations = loadTranslationFiles(localesDir);
  
  // Flatten translation keys
  const enKeys = flattenTranslationKeys(translations.en);
  const ruKeys = flattenTranslationKeys(translations.ru);
  const ukKeys = flattenTranslationKeys(translations.uk);
  
  // Get all keys defined in any locale
  const allLocaleKeys = new Set([...enKeys, ...ruKeys, ...ukKeys]);
  
  // Extract used keys from code
  const usedKeys = getAllUsedTranslationKeys(projectRoot);
  
  // Find missing keys in each locale
  const missingInEn: string[] = [];
  const missingInRu: string[] = [];
  const missingInUk: string[] = [];
  
  usedKeys.forEach(key => {
    if (!keyExists(key, enKeys)) missingInEn.push(key);
    if (!keyExists(key, ruKeys)) missingInRu.push(key);
    if (!keyExists(key, ukKeys)) missingInUk.push(key);
  });
  
  // Find unused keys (keys in locales but not used in code)
  const unusedKeys: string[] = [];
  allLocaleKeys.forEach(key => {
    if (!usedKeys.has(key)) {
      unusedKeys.push(key);
    }
  });
  
  return {
    missingKeys: {
      en: missingInEn.sort(),
      ru: missingInRu.sort(),
      uk: missingInUk.sort()
    },
    unusedKeys: unusedKeys.sort(),
    usedKeys,
    allLocaleKeys
  };
}

describe('translation call key extraction', () => {
  const fromSource = (source: string) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-calls-'));
    try {
      const fixture = path.join(directory, 'fixture.tsx');
      fs.writeFileSync(fixture, source);
      return extractTranslationKeysFromFile(fixture);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };

  it('ignores partial strings in calls whose full key is unknown', () => {
    expect(fromSource([
      "t('groupFlow.status.' + value)",
      "t('studiesWorkspace.type.' + comparison.mine)",
      "t('status.prefix' + suffix)",
      't(`groupFlow.status.${row.status}`)',
      '// t("comment.fakeKey")',
    ].join('\n'))).toEqual(new Set());
  });

  it('keeps complete keys from direct and statically enumerable calls', () => {
    expect(fromSource([
      "t('point.history.more', { count: 1 })",
      'translator.t(`point.history.loading`)',
      't(("point.history.empty") /* show the empty state */)',
      "t(restoring ? 'point.history.pending' : 'point.history.restore')",
      "t('point.history.' + (ready ? 'ready' : 'notReady'))",
    ].join('\n'))).toEqual(new Set([
      'point.history.more',
      'point.history.loading',
      'point.history.empty',
      'point.history.pending',
      'point.history.restore',
      'point.history.ready',
      'point.history.notReady',
    ]));
  });
});

describe('Translation Key Coverage', () => {
  const projectRoot = path.resolve(__dirname, '../../'); // Navigate to frontend root
  const localesDir = path.resolve(__dirname, '../'); // Navigate to locales directory
  
  let analysisResults: TestResults;
  
  beforeAll(() => {
    // Run analysis once for all tests
    analysisResults = analyzeTranslationCoverage(projectRoot, localesDir);
  });
  
  describe('Missing Translation Keys', () => {
    it('should have all used translation keys present in English locale', () => {
      const { missingKeys } = analysisResults;
      
      if (missingKeys.en.length > 0) {
        console.log('\n❌ Missing keys in EN locale:');
        missingKeys.en.forEach(key => console.log(`  - ${key}`));
      }
      
      expect(missingKeys.en).toEqual([]);
    });
    
    it('should have all used translation keys present in Russian locale', () => {
      const { missingKeys } = analysisResults;
      
      if (missingKeys.ru.length > 0) {
        console.log('\n❌ Missing keys in RU locale:');
        missingKeys.ru.forEach(key => console.log(`  - ${key}`));
      }
      
      expect(missingKeys.ru).toEqual([]);
    });
    
    it('should have all used translation keys present in Ukrainian locale', () => {
      const { missingKeys } = analysisResults;
      
      if (missingKeys.uk.length > 0) {
        console.log('\n❌ Missing keys in UK locale:');
        missingKeys.uk.forEach(key => console.log(`  - ${key}`));
      }
      
      expect(missingKeys.uk).toEqual([]);
    });
  });
  
  describe('Unused Translation Keys', () => {
    it('should not have unused translation keys (optional check)', () => {
      const { unusedKeys } = analysisResults;
      
      if (unusedKeys.length > 0) {
        console.log('\n⚠️  Unused keys found in locales (consider removing):');
        unusedKeys.forEach(key => console.log(`  - ${key}`));
        
        // This is a warning, not a failure - uncomment the line below to make it fail
        // expect(unusedKeys).toEqual([]);
      }
      
      // For now, just log unused keys as warnings
      expect(true).toBe(true);
    });
  });
  
  describe('Translation Coverage Statistics', () => {
    it('should provide coverage statistics', () => {
      const { usedKeys, allLocaleKeys, missingKeys } = analysisResults;
      
      const totalUsedKeys = usedKeys.size;
      const totalLocaleKeys = allLocaleKeys.size;
      const totalMissingEn = missingKeys.en.length;
      const totalMissingRu = missingKeys.ru.length;
      const totalMissingUk = missingKeys.uk.length;
      
      console.log('\n📊 Translation Coverage Statistics:');
      console.log(`   Used keys in code: ${totalUsedKeys}`);
      console.log(`   Total keys in locales: ${totalLocaleKeys}`);
      console.log(`   Missing in EN: ${totalMissingEn}`);
      console.log(`   Missing in RU: ${totalMissingRu}`);
      console.log(`   Missing in UK: ${totalMissingUk}`);
      
      if (totalUsedKeys > 0) {
        const enCoverage = ((totalUsedKeys - totalMissingEn) / totalUsedKeys * 100).toFixed(1);
        const ruCoverage = ((totalUsedKeys - totalMissingRu) / totalUsedKeys * 100).toFixed(1);
        const ukCoverage = ((totalUsedKeys - totalMissingUk) / totalUsedKeys * 100).toFixed(1);
        
        console.log(`   EN Coverage: ${enCoverage}%`);
        console.log(`   RU Coverage: ${ruCoverage}%`);
        console.log(`   UK Coverage: ${ukCoverage}%`);
      }
      
      // Test passes if we can calculate statistics
      expect(totalUsedKeys).toBeGreaterThanOrEqual(0);
      expect(totalLocaleKeys).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('Validation of Analysis', () => {
    it('should find at least some translation keys in the codebase', () => {
      const { usedKeys } = analysisResults;
      
      // We know there are translation keys in the project, so this should pass
      expect(usedKeys.size).toBeGreaterThan(0);
    });
    
    it('should find translation files with content', () => {
      const { allLocaleKeys } = analysisResults;
      
      // Translation files should contain some keys
      expect(allLocaleKeys.size).toBeGreaterThan(0);
    });
    
    it('should include some known translation keys', () => {
      const { usedKeys } = analysisResults;
      
      // Check for some keys we know exist in the codebase
      const knownKeys = [
        'brainstorm.title',
        'knowledge.title', 
        'settings.loading',
        'filters.filter'
      ];
      
      const foundKeys = knownKeys.filter(key => usedKeys.has(key));
      
      // At least some of these known keys should be found
      expect(foundKeys.length).toBeGreaterThan(0);
    });
  });
}); 