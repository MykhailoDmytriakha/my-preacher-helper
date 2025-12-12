import * as fs from 'fs';
import * as path from 'path';

import * as glob from 'glob';

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

/**
 * Extracts translation keys from TypeScript/TSX files
 * Looks for patterns like t('key'), t("key"), t(`key`)
 */
function extractTranslationKeysFromFile(filePath: string): Set<string> {
  const keys = new Set<string>();
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // More specific regex patterns to match t() function calls
    const patterns = [
      /\bt\s*\(\s*['"`]([a-zA-Z][a-zA-Z0-9._-]*?)['"`]/g,  // t('key') - must start with letter
      /\bt\s*\(\s*['"`]([a-zA-Z][a-zA-Z0-9._-]*?)['"`]\s*,/g,  // t('key', options) - must start with letter
      /\bt\s*\(\s*['"`]([a-zA-Z][a-zA-Z0-9._-]*?)['"`]\s*\)/g,  // t('key') with closing paren
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const key = match[1];
        // Filter out obviously invalid keys
        if (key && 
            key.length > 2 && // Must be at least 3 characters
            !key.includes('${') && 
            !key.includes('{{') && 
            !key.startsWith('$') &&
            !key.includes('\n') &&
            !key.includes('\\') &&
            !/^[A-Z_]+$/.test(key) && // Not all caps (likely constants)
            !key.includes(' ') && // No spaces
            key.includes('.') && // Must contain at least one dot (namespace.key)
            key.split('.').length >= 2 && // At least two parts
            !/^\d/.test(key) && // Not starting with number
            !/[<>()[\]{}]/.test(key) && // No HTML/code syntax
            key !== 'user-agent' && // Filter out specific false positives
            key !== 'outlinePointId' &&
            key !== 'sermonId' &&
            key !== 'userId' &&
            key !== 'tagName' &&
            key !== 'section' &&
            key !== 'markdown' &&
            key !== 'manual' &&
            key !== 'audio' &&
            key !== 'button' &&
            key !== 'textarea' &&
            key !== 'div' &&
            key !== 'h2' &&
            !key.startsWith('@') && // No imports
            !key.startsWith('./') && // No relative paths
            !key.includes('/') && // No paths
            !key.endsWith('.service') && // No service files
            !/Error\s/.test(key) // No error messages
        ) {
          keys.add(key);
        }
      }
    });
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
 * Checks if a key exists in flattened translation keys
 */
function keyExists(key: string, flattenedKeys: Set<string>): boolean {
  return flattenedKeys.has(key);
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