#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  // Run Jest with coverage and wait for it to complete
  console.log('Running tests with coverage...');
  const jestOutput = execSync('npx jest --coverage --coverageReporters=json-summary,text', { encoding: 'utf8' });
  
  // Extract the test summary information
  const testSuitesMatch = jestOutput.match(/Test Suites:(.+)/);
  const testsMatch = jestOutput.match(/Tests:(.+)/);
  const snapshotsMatch = jestOutput.match(/Snapshots:(.+)/);
  const timeMatch = jestOutput.match(/Time:(.+)/);
  
  // Calculate the total coverage
  const coveragePath = path.join(__dirname, 'coverage', 'coverage-summary.json');
  
  // Wait a moment to ensure file is written
  setTimeout(() => {
    try {
      // Check if the file exists
      if (!fs.existsSync(coveragePath)) {
        console.error('Coverage file not found. Please ensure tests are running with the json-summary reporter.');
        // Output the test results anyway
        console.log(testSuitesMatch ? testSuitesMatch[0] : 'Test Suites: N/A');
        console.log(testsMatch ? testsMatch[0] : 'Tests: N/A');
        console.log(snapshotsMatch ? snapshotsMatch[0] : 'Snapshots: N/A');
        console.log('Total coverage: N/A (coverage file not found)');
        console.log(timeMatch ? timeMatch[0] : 'Time: N/A');
        return;
      }
      
      const coverageData = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
      const total = coverageData.total;
      
      // Calculate the average coverage across statement, branch, function, and line
      const categories = ['statements', 'branches', 'functions', 'lines'];
      const totalCoverage = categories.reduce((sum, category) => 
        sum + total[category].pct, 0) / categories.length;
      
      // Format the output exactly as requested
      console.log(testSuitesMatch ? testSuitesMatch[0] : 'Test Suites: N/A');
      console.log(testsMatch ? testsMatch[0] : 'Tests: N/A');
      console.log(snapshotsMatch ? snapshotsMatch[0] : 'Snapshots: N/A');
      console.log(`Total coverage: ${totalCoverage.toFixed(2)}%`);
      console.log(timeMatch ? timeMatch[0] : 'Time: N/A');
    } catch (err) {
      console.error('Error processing coverage data:', err);
      process.exit(1);
    }
  }, 1000); // Wait 1 second for file to be written
  
} catch (error) {
  console.error('Error running tests:', error.message);
  process.exit(1);
} 