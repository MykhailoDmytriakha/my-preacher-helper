const fs = require('fs');
const path = require('path');

// Function to parse coverage-summary.json and calculate total coverage
function calculateTotalCoverage() {
  try {
    const coveragePath = path.join(__dirname, 'coverage', 'coverage-summary.json');
    
    // Check if the file exists before attempting to read it
    if (!fs.existsSync(coveragePath)) {
      return 'N/A (coverage file not found)';
    }
    
    const coverageData = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    
    // Get the total object which contains coverage summaries
    const total = coverageData.total;
    
    // Calculate average of statement, branch, function and line coverage
    const statementCoverage = total.statements.pct;
    const branchCoverage = total.branches.pct;
    const functionCoverage = total.functions.pct;
    const lineCoverage = total.lines.pct;
    
    // Calculate simple average
    const totalCoverage = (statementCoverage + branchCoverage + functionCoverage + lineCoverage) / 4;
    return totalCoverage.toFixed(2);
  } catch (error) {
    console.error('Error calculating total coverage:', error);
    return 'N/A';
  }
}

// Run this after Jest completes
module.exports = class CustomReporter {
  constructor(globalConfig, options) {
    this.globalConfig = globalConfig;
    this.options = options;
  }

  onRunComplete(contexts, results) {
    // Give the json-summary reporter some time to write the file
    setTimeout(() => {
      const totalCoverage = calculateTotalCoverage();
      console.log(`\nTotal coverage: ${totalCoverage}%\n`);
    }, 500); // 500ms delay to ensure file is written
  }
}; 