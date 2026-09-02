#!/usr/bin/env node

const { spawn } = require('node:child_process')

const formatSeconds = milliseconds => `${(milliseconds / 1000).toFixed(2)}s`

const createBuildCommands = ({
  cwd = process.cwd(),
  env = process.env,
  jestCli = require.resolve('jest/bin/jest'),
  nextCli = require.resolve('next/dist/bin/next'),
  nodeExecutable = process.execPath,
  tscCli = require.resolve('typescript/bin/tsc'),
} = {}) => ({
  typegen: {
    args: [nextCli, 'typegen'],
    cwd,
    env: { ...env, NEXT_TYPEGEN_DIST_DIR: '.next-typecheck' },
    executable: nodeExecutable,
    label: 'Next.js route type generation',
  },
  build: {
    args: [nextCli, 'build'],
    cwd,
    env: { ...env, NEXT_EXTERNAL_TYPECHECK: 'true' },
    executable: nodeExecutable,
    label: 'Next.js production build',
  },
  test: {
    args: [jestCli, '--passWithNoTests', '--maxWorkers=100%'],
    cwd,
    env: { ...env, JEST_SHOW_LOGS: 'false', NODE_ENV: 'test' },
    executable: nodeExecutable,
    label: 'Jest test suite',
  },
  typecheck: {
    args: [
      tscCli,
      '--project',
      'tsconfig.build.json',
      '--noEmit',
      '--incremental',
      '--tsBuildInfoFile',
      '.next/cache/typecheck-build.tsbuildinfo',
    ],
    cwd,
    env,
    executable: nodeExecutable,
    label: 'TypeScript validation',
  },
})

const executeCommand = command => new Promise((resolve, reject) => {
  const startedAt = Date.now()
  console.log(`[build] ${command.label} started`)

  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    env: command.env,
    stdio: 'inherit',
  })

  child.once('error', error => {
    reject(new Error(`${command.label} could not start: ${error.message}`))
  })

  child.once('exit', (code, signal) => {
    if (code === 0) {
      console.log(`[build] ${command.label} completed in ${formatSeconds(Date.now() - startedAt)}`)
      resolve()
      return
    }

    const outcome = signal ? `signal ${signal}` : `exit code ${code}`
    reject(new Error(`${command.label} failed with ${outcome}`))
  })
})

const runProductionBuild = async ({
  commands = createBuildCommands(),
  execute = executeCommand,
} = {}) => {
  await execute(commands.typegen)

  const parallelResults = await Promise.allSettled([
    execute(commands.test),
    execute(commands.build),
    execute(commands.typecheck),
  ])
  const failures = parallelResults
    .filter(result => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason))

  if (failures.length > 0) {
    throw new Error(`Production build failed:\n${failures.join('\n')}`)
  }
}

if (require.main === module) {
  runProductionBuild().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = {
  createBuildCommands,
  executeCommand,
  runProductionBuild,
}
