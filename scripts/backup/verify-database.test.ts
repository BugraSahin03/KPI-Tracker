// @vitest-environment node
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { PaceDatabase } from '../../server/db'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const verifier = path.resolve('scripts/backup/verify-database.mjs')

function databaseFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-verify-'))
  roots.push(root)
  const filename = path.join(root, 'pace.sqlite')
  new PaceDatabase(filename).close()
  return filename
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Production-Datenbankverifier', () => {
  it('akzeptiert ausschließlich eine vollständige Schema-10-Pace-Datenbank', async () => {
    const filename = databaseFile()
    await expect(execFileAsync(process.execPath, [verifier, filename])).resolves.toMatchObject({ stdout: expect.stringContaining('Schema 10') })
  })

  it('lehnt zu neue Schemas, fehlende Profile/Tabellen und Fremdschlüsselfehler ab', async () => {
    for (const corruption of ['schema', 'profile', 'table', 'alias-table', 'foreign-key'] as const) {
      const filename = databaseFile()
      const database = new Database(filename)
      if (corruption === 'schema') database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (11,?)').run(new Date().toISOString())
      if (corruption === 'profile') database.prepare("DELETE FROM profiles WHERE id='profile-sena'").run()
      if (corruption === 'table') { database.pragma('foreign_keys=OFF'); database.exec('DROP TABLE app_state') }
      if (corruption === 'alias-table') { database.pragma('foreign_keys=OFF'); database.exec('DROP TABLE gym_exercise_aliases') }
      if (corruption === 'foreign-key') {
        database.pragma('foreign_keys=OFF')
        database.prepare("INSERT INTO daily_entries(profile_id,goal_id,date,status,updated_at) VALUES ('profile-bugra','missing','2026-08-01','done','2026-08-01T12:00:00Z')").run()
      }
      database.close()
      await expect(execFileAsync(process.execPath, [verifier, filename])).rejects.toBeTruthy()
    }
  })

  it('führt den Migrationsmodus ausdrücklich nur auf einer temporären Kopie aus', () => {
    const source = fs.readFileSync(verifier, 'utf8')
    expect(source).toContain("argumentsList[1] !== '1..9'")
    expect(source).toContain("await copySource.backup(temporaryPath)")
    expect(source).toContain("new module.PaceDatabase(temporaryPath)")
    expect(source).not.toContain('new module.PaceDatabase(databasePath)')
  })
})
