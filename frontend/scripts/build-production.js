#!/usr/bin/env node

const { spawn } = require('node:child_process')

const formatSeconds = milliseconds => `${(milliseconds / 1000).toFixed(2)}s`

const createBuildCommands = ({
  cwd = process.cwd(),
  env = process.env,
  nextCli = require.resolve('next/dist/bin/next'),
  nodeExecutable = process.execPath,
  tscCli = require.resolve('typescript/bin/tsc'),
} = {}) => {
  const typecheck = {
    args: [tscCli, '--project', 'tsconfig.build.json', '--noEmit'],
    cwd,
    env,
    executable: nodeExecutable,
  }

  return {
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
    typecheck: {
      ...typecheck,
      args: [
        ...typecheck.args,
        '--incremental',
        '--tsBuildInfoFile',
        '.next/cache/typecheck-build.tsbuildinfo',
      ],
      label: 'TypeScript validation',
    },
    typecheckClean: {
      ...typecheck,
      args: [...typecheck.args, '--incremental', 'false'],
      label: 'TypeScript validation without build cache',
    },
  }
}

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
    reject(Object.assign(new Error(`${command.label} failed with ${outcome}`), { exitCode: code }))
  })
})

const runProductionBuild = async ({
  commands = createBuildCommands(),
  execute = executeCommand,
} = {}) => {
  await execute(commands.typegen)

  const parallelResults = await Promise.allSettled([
    execute(commands.build),
    execute(commands.typecheck).catch(error => {
      if (!Number.isInteger(error?.exitCode)) throw error

      console.log('[build] Cached TypeScript validation failed; checking without the build cache')
      return execute(commands.typecheckClean)
    }),
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
