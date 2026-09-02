const {
  createBuildCommands,
  runProductionBuild,
} = require('../build-production')

const createTestCommands = () => createBuildCommands({
  cwd: '/project',
  env: { TEST_ENV: 'true' },
  jestCli: '/project/node_modules/jest/bin/jest.js',
  nextCli: '/project/node_modules/next/dist/bin/next',
  nodeExecutable: '/usr/bin/node',
  tscCli: '/project/node_modules/typescript/bin/tsc',
})

describe('production build orchestration', () => {
  it('generates route types before starting tests, the production build, and strict type validation in parallel', async () => {
    const commands = createTestCommands()
    const events = []
    let finishTypegen
    const typegenPending = new Promise(resolve => {
      finishTypegen = resolve
    })
    const execute = jest.fn(command => {
      events.push(`start:${command.label}`)
      if (command === commands.typegen) {
        return typegenPending.then(() => {
          events.push(`finish:${command.label}`)
        })
      }
      events.push(`finish:${command.label}`)
      return Promise.resolve()
    })

    const buildPending = runProductionBuild({ commands, execute })
    await Promise.resolve()

    expect(events).toEqual(['start:Next.js route type generation'])

    finishTypegen()
    await buildPending

    expect(events).toEqual([
      'start:Next.js route type generation',
      'finish:Next.js route type generation',
      'start:Jest test suite',
      'finish:Jest test suite',
      'start:Next.js production build',
      'finish:Next.js production build',
      'start:TypeScript validation',
      'finish:TypeScript validation',
    ])
    expect(commands.typecheck.args).toContain('--noEmit')
    expect(commands.test.args).toContain('--maxWorkers=100%')
    expect(commands.test.env).toMatchObject({ JEST_SHOW_LOGS: 'false', NODE_ENV: 'test' })
    expect(commands.typecheck.args).toContain('tsconfig.build.json')
    expect(commands.typegen.env.NEXT_TYPEGEN_DIST_DIR).toBe('.next-typecheck')
    expect(commands.build.env.NEXT_EXTERNAL_TYPECHECK).toBe('true')
  })

  it.each([
    ['Jest test suite', 'test'],
    ['Next.js production build', 'build'],
    ['TypeScript validation', 'typecheck'],
  ])('fails the production build when %s fails', async (label, failingCommand) => {
    const commands = createTestCommands()
    const execute = jest.fn(command => {
      if (command === commands[failingCommand]) {
        return Promise.reject(new Error(`${label} failed with exit code 2`))
      }
      return Promise.resolve()
    })

    await expect(runProductionBuild({ commands, execute })).rejects.toThrow(
      `${label} failed with exit code 2`,
    )
    expect(execute).toHaveBeenCalledWith(commands.build)
    expect(execute).toHaveBeenCalledWith(commands.test)
    expect(execute).toHaveBeenCalledWith(commands.typecheck)
  })

  it('does not start build stages when route type generation fails', async () => {
    const commands = createTestCommands()
    const execute = jest.fn(command => {
      if (command === commands.typegen) {
        return Promise.reject(new Error('Next.js route type generation failed with exit code 1'))
      }
      return Promise.resolve()
    })

    await expect(runProductionBuild({ commands, execute })).rejects.toThrow(
      'Next.js route type generation failed with exit code 1',
    )
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(commands.typegen)
  })
})
