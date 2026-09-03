class FailureOnlyJestReporter {
  constructor() {
    this.output = process.stderr
  }

  onTestResult(test, result) {
    if (result.numFailingTests === 0 && !result.testExecError) return

    const detail = result.failureMessage || result.testExecError?.message || 'Unknown test failure'
    this.output.write(`FAIL ${test.path}\n${detail}\n`)
  }
}

module.exports = FailureOnlyJestReporter
