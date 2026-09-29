/**
 * @jest-environment node
 */
const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SCRIPT = path.resolve(__dirname, '../vercel-ignore-build.sh')

// A throwaway repository with the same layout as ours: the app under frontend/, notes at the root.
function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-ignore-build-'))
  const git = (...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com',
    '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' }).trim()
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  const commit = (message) => {
    git('add', '-A')
    git('commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '-q')
  write('BUGS.md', 'bugs\n')
  write('frontend/app/page.tsx', 'export default 1\n')
  write('frontend/firestore.rules', 'rules\n')
  const base = commit('base')
  return { root, git, write, commit, base }
}

// Exit 1 builds, exit 0 skips — Vercel's contract for an ignore command.
function decide(repository, env) {
  const result = spawnSync('bash', [SCRIPT], {
    cwd: path.join(repository.root, 'frontend'),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: 'utf8',
  })
  return { build: result.status === 1, skip: result.status === 0, status: result.status, output: result.stdout }
}

describe('Vercel ignored build step', () => {
  let repository

  beforeEach(() => {
    repository = createRepository()
  })

  afterEach(() => {
    fs.rmSync(repository.root, { recursive: true, force: true })
  })

  it('skips a commit that only changes notes outside the app', () => {
    repository.write('BUGS.md', 'bugs, updated\n')
    const current = repository.commit('docs')

    expect(decide(repository, { VERCEL_GIT_PREVIOUS_SHA: repository.base, VERCEL_GIT_COMMIT_SHA: current }).skip).toBe(true)
  })

  it('skips a commit that only changes Firestore rules, which neither the build nor Jest read', () => {
    repository.write('frontend/firestore.rules', 'rules, tightened\n')
    const current = repository.commit('rules')

    expect(decide(repository, { VERCEL_GIT_PREVIOUS_SHA: repository.base, VERCEL_GIT_COMMIT_SHA: current }).skip).toBe(true)
  })

  it('builds when app code changed', () => {
    repository.write('frontend/app/page.tsx', 'export default 2\n')
    const current = repository.commit('app')

    expect(decide(repository, { VERCEL_GIT_PREVIOUS_SHA: repository.base, VERCEL_GIT_COMMIT_SHA: current }).build).toBe(true)
  })

  it('builds when a new app file appears', () => {
    repository.write('frontend/app/new.ts', 'export const added = true\n')
    const current = repository.commit('new file')

    expect(decide(repository, { VERCEL_GIT_PREVIOUS_SHA: repository.base, VERCEL_GIT_COMMIT_SHA: current }).build).toBe(true)
  })

  it('builds when an app change hides behind a later notes-only commit of the same push', () => {
    repository.write('frontend/app/page.tsx', 'export default 3\n')
    repository.commit('app')
    repository.write('BUGS.md', 'bugs, again\n')
    const current = repository.commit('docs on top')

    expect(decide(repository, { VERCEL_GIT_PREVIOUS_SHA: repository.base, VERCEL_GIT_COMMIT_SHA: current }).build).toBe(true)
  })

  it('builds a redeploy of the same commit, the way environment changes reach production', () => {
    expect(decide(repository, { VERCEL_GIT_PREVIOUS_SHA: repository.base, VERCEL_GIT_COMMIT_SHA: repository.base }).build).toBe(true)
  })

  it('builds a redeploy of an older commit even when its app files match the latest deployment', () => {
    repository.write('BUGS.md', 'bugs, later\n')
    const later = repository.commit('docs')

    expect(decide(repository, { VERCEL_GIT_PREVIOUS_SHA: later, VERCEL_GIT_COMMIT_SHA: repository.base }).build).toBe(true)
  })

  it('builds a commit whose history does not contain the previous deployment', () => {
    repository.write('BUGS.md', 'bugs on main\n')
    const deployed = repository.commit('main docs')
    repository.git('checkout', '-q', '-b', 'rewritten', repository.base)
    repository.write('BUGS.md', 'bugs on a rewritten branch\n')
    const current = repository.commit('rewritten docs')

    expect(decide(repository, { VERCEL_GIT_PREVIOUS_SHA: deployed, VERCEL_GIT_COMMIT_SHA: current }).build).toBe(true)
  })

  it('builds when there is no previous deployment to compare with', () => {
    expect(decide(repository, { VERCEL_GIT_COMMIT_SHA: repository.base }).build).toBe(true)
  })

  it('builds when the previous deployment cannot be reached from the clone', () => {
    const decision = decide(repository, {
      VERCEL_GIT_PREVIOUS_SHA: '0123456789abcdef0123456789abcdef01234567',
      VERCEL_GIT_COMMIT_SHA: repository.base,
    })

    expect(decision.build).toBe(true)
    expect(decision.output).toContain('not reachable')
  })
})
