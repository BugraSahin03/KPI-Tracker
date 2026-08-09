// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const router = path.resolve('scripts/deploy/run-restore-verifier.mjs')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-restore-routing-'))
  roots.push(root)
  const releases = path.join(root, 'releases')
  const log = path.join(root, 'routing.log')
  for (const label of ['current', 'target']) {
    const directory = path.join(releases, label, 'scripts', 'backup')
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'verify-database.mjs'), `import fs from 'node:fs'; const value=fs.readFileSync(process.argv[2],'utf8'); fs.appendFileSync(process.env.ROUTING_LOG,'${label}\\n'); if(value!=='${label}') process.exit(23);`)
  }
  fs.writeFileSync(path.join(root, 'current.sqlite'), 'current')
  fs.writeFileSync(path.join(root, 'target.sqlite'), 'target')
  return { root, releases, log, current: path.join(releases, 'current'), target: path.join(releases, 'target') }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function route(f: ReturnType<typeof fixture>, phase: string, target: string, database: string) {
  await execFileAsync(process.execPath, [router, phase, f.current, target, database], { env: { ...process.env, PACE_RELEASES_DIR: f.releases, ROUTING_LOG: f.log } })
}

describe('Restore-Verifier-Routing', () => {
  it('nutzt bei Cross-Schema-Restore target für Input/Final und current für Safety/Rollback', async () => {
    const f = fixture()
    await route(f, 'input', f.target, path.join(f.root, 'target.sqlite'))
    await route(f, 'safety', f.target, path.join(f.root, 'current.sqlite'))
    await route(f, 'rollback', f.target, path.join(f.root, 'current.sqlite'))
    await route(f, 'final', f.target, path.join(f.root, 'target.sqlite'))
    expect(fs.readFileSync(f.log, 'utf8').trim().split('\n')).toEqual(['target', 'current', 'current', 'target'])
  })

  it('routet beim DB-only-Restore alle Phasen auf current', async () => {
    const f = fixture()
    for (const phase of ['input', 'safety', 'rollback', 'final']) await route(f, phase, f.current, path.join(f.root, 'current.sqlite'))
    expect(fs.readFileSync(f.log, 'utf8').trim().split('\n')).toEqual(['current', 'current', 'current', 'current'])
  })

  it('weist Releases außerhalb des kanonischen Release-Roots zurück', async () => {
    const f = fixture()
    const outside = path.join(f.root, 'outside')
    fs.mkdirSync(path.join(outside, 'scripts', 'backup'), { recursive: true })
    fs.writeFileSync(path.join(outside, 'scripts', 'backup', 'verify-database.mjs'), '')
    await expect(route(f, 'input', outside, path.join(f.root, 'target.sqlite'))).rejects.toBeTruthy()
  })
})
