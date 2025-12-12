#!/usr/bin/env node

/**
 * This script helps identify components using inline SVGs that should be 
 * migrated to use the standardized icon components from Icons.tsx
 */

const fs = require('fs');
const path = require('path');

// Configuration
const COMPONENTS_DIR = path.resolve(__dirname, '../app/components');
const PAGES_DIR = path.resolve(__dirname, '../app/(pages)');
const IGNORED_DIRS = ['node_modules', '.next', 'coverage'];
const SVG_PATTERN = /<svg[^>]*>[\s\S]*?<\/svg>/g;

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

console.log(`${colors.cyan}Searching for inline SVGs that should be migrated to use standardized icon components...${colors.reset}\n`);

// Using a different approach with Node.js file system operations
function searchFilesForSVG(directory) {
  const results = {};
  
  try {
    // Read all files in the directory
    const files = fs.readdirSync(directory);
    
    for (const file of files) {
      const filePath = path.join(directory, file);
      const stats = fs.statSync(filePath);
      
      // Skip ignored directories
      if (stats.isDirectory() && !IGNORED_DIRS.includes(file)) {
        // Recursively search subdirectories
        const subResults = searchFilesForSVG(filePath);
        Object.assign(results, subResults);
      } 
      // Check TypeScript/JavaScript/JSX files for SVG tags
      else if (stats.isFile() && /\.(tsx|jsx|js|ts)$/.test(file)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const matches = content.match(SVG_PATTERN);
        
        if (matches && matches.length > 0) {
          results[filePath] = matches.length;
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error(`${colors.red}Error reading directory ${directory}:${colors.reset}`, error.message);
    return results;
  }
}

try {
  // Search components and pages directories
  const componentResults = searchFilesForSVG(COMPONENTS_DIR);
  const pagesResults = searchFilesForSVG(PAGES_DIR);
  
  // Combine results
  const allResults = { ...componentResults, ...pagesResults };
  const totalFiles = Object.keys(allResults).length;
  
  console.log(`${colors.green}Found ${totalFiles} files with potential inline SVGs:${colors.reset}\n`);
  
  if (totalFiles > 0) {
    Object.entries(allResults)
      .sort((a, b) => b[1] - a[1]) // Sort by count (most occurrences first)
      .forEach(([filePath, count]) => {
        const relativePath = path.relative(path.resolve(__dirname, '..'), filePath);
        console.log(`${colors.yellow}${relativePath}${colors.reset} - ${count} occurrence${count === 1 ? '' : 's'}`);
      });
    
    console.log(`\n${colors.cyan}Next steps:${colors.reset}`);
    console.log(`1. Review these files and replace inline SVGs with standardized components from Icons.tsx`);
    console.log(`2. Check the ICON-STANDARDS.md document for migration guidelines`);
    console.log(`3. Add any missing icon types to Icons.tsx as needed`);
  } else {
    console.log(`${colors.green}No inline SVGs found. Great job!${colors.reset}`);
  }
} catch (error) {
  console.error(`${colors.red}Error:${colors.reset}`, error.message);
  process.exit(1);
} 