const FailureOnlyJestReporter = require('../failure-only-jest-reporter')

describe('FailureOnlyJestReporter', () => {
  const createReporter = () => {
    const reporter = new FailureOnlyJestReporter()
    reporter.output = { write: jest.fn() }
    return reporter
  }

  it('keeps successful suites quiet', () => {
    const reporter = createReporter()

    reporter.onTestResult(
      { path: '/project/passing.test.ts' },
      { failureMessage: null, numFailingTests: 0, testExecError: null },
    )

    expect(reporter.output.write).not.toHaveBeenCalled()
  })

  it('prints the full assertion failure for a failed suite', () => {
    const reporter = createReporter()

    reporter.onTestResult(
      { path: '/project/failing.test.ts' },
      { failureMessage: 'Expected 1 to equal 2', numFailingTests: 1, testExecError: null },
    )

    expect(reporter.output.write).toHaveBeenCalledWith(
      'FAIL /project/failing.test.ts\nExpected 1 to equal 2\n',
    )
  })

  it('prints execution errors even when no assertion ran', () => {
    const reporter = createReporter()

    reporter.onTestResult(
      { path: '/project/broken.test.ts' },
      { failureMessage: null, numFailingTests: 0, testExecError: new Error('Syntax exploded') },
    )

    expect(reporter.output.write).toHaveBeenCalledWith(
      'FAIL /project/broken.test.ts\nSyntax exploded\n',
    )
  })
})
