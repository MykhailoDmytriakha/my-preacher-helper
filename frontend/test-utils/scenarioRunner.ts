interface Scenario {
  name: string
  run: () => void | Promise<void>
}

interface ScenarioRunnerOptions {
  beforeEachScenario?: () => void | Promise<void>
  afterEachScenario?: () => void | Promise<void>
}

/**
 * Runs multiple logical test scenarios inside a single Jest `it` block
 * while preserving helpful failure context.
 */
export async function runScenarios(
  scenarios: Scenario[],
  options: ScenarioRunnerOptions = {}
) {
  const { beforeEachScenario, afterEachScenario } = options

  for (const { name, run } of scenarios) {
    let capturedError: Error | null = null

    if (beforeEachScenario) {
      await beforeEachScenario()
    }

    try {
      await run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      capturedError = new Error(`[Scenario: ${name}] ${message}`)
    }

    if (afterEachScenario) {
      await afterEachScenario()
    }

    if (capturedError) {
      throw capturedError
    }
  }
}
