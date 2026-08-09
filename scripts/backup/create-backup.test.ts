// @vitest-environment node
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createBackup, parseRetentionDays } from './create-backup.mjs'

const directories: string[] = []
const execFileAsync = promisify(execFile)
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Pace Backup', () => {
  it('erstellt atomar ein valides 0600-Backup und entfernt nur alte Pace-Backups', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-backup-'))
    directories.push(root)
    const databasePath = path.join(root, 'pace.sqlite')
    const backupDir = path.join(root, 'backups')
    const database = new Database(databasePath)
    database.exec('CREATE TABLE values_table(value TEXT); INSERT INTO values_table VALUES (\'bleibt\')')
    database.close()
    fs.mkdirSync(backupDir)
    const oldBackup = path.join(backupDir, 'pace-20200101T000000.000Z.sqlite')
    fs.writeFileSync(oldBackup, 'alt')
    fs.utimesSync(oldBackup, new Date('2020-01-01'), new Date('2020-01-01'))
    const unrelated = path.join(backupDir, 'notes.txt')
    fs.writeFileSync(unrelated, 'nicht löschen')

    const result = await createBackup({ databasePath, backupDir, retentionDays: 30, now: new Date('2026-08-08T12:00:00.000Z') })
    expect(result.removed).toEqual(['pace-20200101T000000.000Z.sqlite'])
    expect(fs.existsSync(unrelated)).toBe(true)
    expect(fs.statSync(result.path).mode & 0o777).toBe(0o600)
    const restored = new Database(result.path, { readonly: true })
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(restored.prepare('SELECT value FROM values_table').pluck().get()).toBe('bleibt')
    restored.close()
    expect(fs.readdirSync(backupDir).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it.each(['0', '-1', '1.5', 'NaN', '3651'])('weist gefährliche Retention %s zurück', (value) => {
    expect(() => parseRetentionDays(value)).toThrow('PACE_BACKUP_RETENTION_DAYS')
  })

  it('überschreibt bei zwei echten Prozessen mit gleichem Ziel niemals ein Backup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-backup-race-'))
    directories.push(root)
    const databasePath = path.join(root, 'pace.sqlite')
    const backupDir = path.join(root, 'backups')
    const database = new Database(databasePath)
    database.exec('CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES (\'integer\')')
    database.close()
    const script = path.resolve('scripts/backup/create-backup.mjs')
    const environment = { ...process.env, PACE_DATABASE_PATH: databasePath, PACE_BACKUP_DIR: backupDir, PACE_BACKUP_FILENAME: 'pace-rollback-20260808T120000.000Z.sqlite' }
    const results = await Promise.allSettled([
      execFileAsync(process.execPath, [script], { env: environment }),
      execFileAsync(process.execPath, [script], { env: environment }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const files = fs.readdirSync(backupDir)
    expect(files).toEqual(['pace-rollback-20260808T120000.000Z.sqlite'])
    const backup = new Database(path.join(backupDir, files[0]!), { readonly: true })
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(backup.prepare('SELECT value FROM marker').pluck().get()).toBe('integer')
    backup.close()
  })

  it('rotiert nur tägliche Backups und bewahrt Release-Snapshots in Unterverzeichnissen', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-retention-scope-'))
    directories.push(root)
    const databasePath = path.join(root, 'pace.sqlite')
    const backupDir = path.join(root, 'backups')
    const database = new Database(databasePath)
    database.exec('CREATE TABLE marker(value TEXT)')
    database.close()
    fs.mkdirSync(path.join(backupDir, 'releases', 'old-release'), { recursive: true })
    const daily = path.join(backupDir, 'pace-20200101T000000.000Z.sqlite')
    const releaseSnapshot = path.join(backupDir, 'releases', 'old-release', 'pace-rollback-20200101T000000.000Z.sqlite')
    fs.writeFileSync(daily, 'daily')
    fs.writeFileSync(releaseSnapshot, 'release')
    fs.utimesSync(daily, new Date('2020-01-01'), new Date('2020-01-01'))
    await createBackup({ databasePath, backupDir, retentionDays: 30, now: new Date('2026-08-08T12:00:00.000Z') })
    expect(fs.existsSync(daily)).toBe(false)
    expect(fs.existsSync(releaseSnapshot)).toBe(true)
  })
})
