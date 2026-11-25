const {
  createBuildCommands,
  runProductionBuild,
} = require('../build-production')

const createTestCommands = () => createBuildCommands({
  cwd: '/project',
  env: { TEST_ENV: 'true' },
  nextCli: '/project/node_modules/next/dist/bin/next',
  nodeExecutable: '/usr/bin/node',
  tscCli: '/project/node_modules/typescript/bin/tsc',
})

describe('production build orchestration', () => {
  it('generates route types before starting the production build and strict type validation in parallel', async () => {
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
      'start:Next.js production build',
      'finish:Next.js production build',
      'start:TypeScript validation',
      'finish:TypeScript validation',
    ])
    expect(commands.typecheck.args).toContain('--noEmit')
    expect(commands.typecheck.args).toContain('tsconfig.build.json')
    expect(commands.typegen.env.NEXT_TYPEGEN_DIST_DIR).toBe('.next-typecheck')
    expect(commands.build.env.NEXT_EXTERNAL_TYPECHECK).toBe('true')
  })

  it.each([
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
    expect(execute).toHaveBeenCalledWith(commands.typecheck)
  })

  it('continues when clean type validation clears an error from the build cache', async () => {
    const commands = createTestCommands()
    const execute = jest.fn(async command => {
      if (command === commands.typecheck) {
        throw Object.assign(new Error('Cached TypeScript validation failed'), { exitCode: 2 })
      }
    })

    await expect(runProductionBuild({ commands, execute })).resolves.toBeUndefined()

    expect(execute.mock.calls.map(([command]) => command)).toEqual([
      commands.typegen,
      commands.build,
      commands.typecheck,
      commands.typecheckClean,
    ])
    expect(commands.typecheckClean.args).toEqual([
      commands.typecheck.args[0], '--project', 'tsconfig.build.json', '--noEmit', '--incremental', 'false',
    ])
    expect(commands.typecheckClean).toMatchObject({
      cwd: commands.typecheck.cwd,
      env: commands.typecheck.env,
      executable: commands.typecheck.executable,
    })
  })

  it('reports a real type error from the clean check and preserves a simultaneous Next failure', async () => {
    const commands = createTestCommands()
    const execute = jest.fn(async command => {
      if (command === commands.build) throw new Error('Next failed to compile')
      if (command === commands.typecheck) {
        throw Object.assign(new Error('Cached TypeScript validation failed'), { exitCode: 2 })
      }
      if (command === commands.typecheckClean) throw new Error('Fresh TypeScript validation failed')
    })

    await expect(runProductionBuild({ commands, execute })).rejects.toThrow(
      'Production build failed:\nNext failed to compile\nFresh TypeScript validation failed',
    )
    expect(execute).toHaveBeenCalledWith(commands.typecheckClean)
  })

  it('does not restart TypeScript after the compiler was terminated by a signal', async () => {
    const commands = createTestCommands()
    const execute = jest.fn(async command => {
      if (command === commands.typecheck) {
        throw Object.assign(new Error('TypeScript validation failed with signal SIGTERM'), { exitCode: null })
      }
    })

    await expect(runProductionBuild({ commands, execute })).rejects.toThrow('signal SIGTERM')
    expect(execute).toHaveBeenCalledTimes(3)
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
