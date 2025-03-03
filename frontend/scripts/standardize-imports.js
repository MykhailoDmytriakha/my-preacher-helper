#!/usr/bin/env node

/**
 * This script helps identify and standardize import patterns across the project.
 * It finds files with relative imports that should be using path aliases.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(PROJECT_ROOT, 'app');
const IGNORED_DIRS = ['node_modules', '.next', 'coverage', '.git'];

// Path alias mappings from tsconfig.json
const PATH_ALIASES = {
  '@/': './app/',
  '@components/': './app/components/',
  '@services/': './app/services/',
  '@api/': './app/api/',
  '@clients/': './app/api/clients/',
  '@repositories/': './app/api/repositories/',
  '@utils/': './app/utils/',
  '@locales/': './locales/',
};

// Regex patterns
const RELATIVE_IMPORT_PATTERN = /import\s+(?:(?:\{[^}]*\})|(?:[^{}\s]+))\s+from\s+['"](\.\.\/)+(.*)['"]/g;
const POTENTIAL_ALIAS_PATTERN = /import\s+(?:(?:\{[^}]*\})|(?:[^{}\s]+))\s+from\s+['"]((?!@)[\w\/\-\.]+)['"]/g;

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

console.log(`${colors.cyan}Analyzing import patterns in the project...${colors.reset}\n`);

// Function to search for files with problematic imports
function analyzeImports(directory) {
  const issues = {
    relativeImports: {},
    potentialAliases: {},
  };
  
  try {
    const files = fs.readdirSync(directory);
    
    for (const file of files) {
      const filePath = path.join(directory, file);
      const stats = fs.statSync(filePath);
      
      // Skip ignored directories
      if (stats.isDirectory() && !IGNORED_DIRS.includes(file)) {
        // Recursively analyze subdirectories
        const subResults = analyzeImports(filePath);
        
        // Merge results
        Object.keys(subResults.relativeImports).forEach(key => {
          issues.relativeImports[key] = subResults.relativeImports[key];
        });
        
        Object.keys(subResults.potentialAliases).forEach(key => {
          issues.potentialAliases[key] = subResults.potentialAliases[key];
        });
      } 
      // Check TypeScript/JavaScript files for import patterns
      else if (stats.isFile() && /\.(tsx|jsx|ts|js)$/.test(file)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const relativeMatches = Array.from(content.matchAll(RELATIVE_IMPORT_PATTERN));
        const aliasMatches = Array.from(content.matchAll(POTENTIAL_ALIAS_PATTERN));
        
        if (relativeMatches.length > 0) {
          issues.relativeImports[filePath] = relativeMatches.map(match => ({
            fullMatch: match[0],
            relativePath: match[1] + match[2],
          }));
        }
        
        if (aliasMatches.length > 0) {
          issues.potentialAliases[filePath] = aliasMatches.map(match => ({
            fullMatch: match[0],
            importPath: match[1],
          }));
        }
      }
    }
    
    return issues;
  } catch (error) {
    console.error(`${colors.red}Error reading directory ${directory}:${colors.reset}`, error.message);
    return issues;
  }
}

// Function to suggest path alias
function suggestPathAlias(relativePath, filePath) {
  // Convert the file path to be relative to the project root
  const filePathFromRoot = path.relative(PROJECT_ROOT, filePath);
  const fileDir = path.dirname(filePathFromRoot);
  
  // Resolve the relative import to an absolute path
  const absoluteImportPath = path.resolve(path.dirname(filePath), relativePath);
  const importPathFromRoot = path.relative(PROJECT_ROOT, absoluteImportPath);
  
  // Check if the import should use any of our path aliases
  for (const [alias, aliasPath] of Object.entries(PATH_ALIASES)) {
    const normalizedAliasPath = aliasPath.replace(/^\.\//, '');
    if (importPathFromRoot.startsWith(normalizedAliasPath)) {
      return alias + importPathFromRoot.substring(normalizedAliasPath.length);
    }
  }
  
  // If we can't find a specific alias, use the general @/ alias for app imports
  if (importPathFromRoot.startsWith('app/')) {
    return '@/' + importPathFromRoot.substring(4);
  }
  
  return null;
}

try {
  // Analyze imports in the project
  const results = analyzeImports(PROJECT_ROOT);
  
  // Count the issues
  const relativeImportFiles = Object.keys(results.relativeImports).length;
  const relativeImportCount = Object.values(results.relativeImports).reduce((acc, imports) => acc + imports.length, 0);
  
  console.log(`${colors.green}Found ${relativeImportFiles} files with ${relativeImportCount} relative imports that could use path aliases:${colors.reset}\n`);
  
  if (relativeImportFiles > 0) {
    // Display files with relative imports and suggest replacements
    Object.entries(results.relativeImports).forEach(([filePath, imports]) => {
      const relativePath = path.relative(PROJECT_ROOT, filePath);
      console.log(`${colors.yellow}${relativePath}${colors.reset}:`);
      
      imports.forEach(importInfo => {
        const suggestion = suggestPathAlias(importInfo.relativePath, filePath);
        if (suggestion) {
          console.log(`  ${colors.red}${importInfo.fullMatch}${colors.reset}`);
          console.log(`  ${colors.green}${importInfo.fullMatch.replace(importInfo.relativePath, suggestion)}${colors.reset}`);
        } else {
          console.log(`  ${colors.magenta}${importInfo.fullMatch} (no alias suggestion available)${colors.reset}`);
        }
      });
      
      console.log("");
    });
    
    console.log(`${colors.cyan}Next steps:${colors.reset}`);
    console.log(`1. Update imports to use path aliases instead of relative paths`);
    console.log(`2. Consider using an ESLint rule to enforce consistent imports`);
    console.log(`3. Run this script again after making changes to check for remaining issues`);
  } else {
    console.log(`${colors.green}Great job! No problematic relative imports found.${colors.reset}`);
  }
} catch (error) {
  console.error(`${colors.red}Error:${colors.reset}`, error.message);
  process.exit(1);
} 