#!/usr/bin/env node
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DAILY_BACKUP_PATTERN = /^pace-\d{8}T\d{6}\.\d{3}Z\.sqlite$/
const SAFE_BACKUP_FILENAME = /^(?:pace-\d{8}T\d{6}\.\d{3}Z|pace-rollback-\d{8}T\d{6}\.\d{3}Z)\.sqlite$/

export function parseRetentionDays(raw = '30') {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error('PACE_BACKUP_RETENTION_DAYS muss eine ganze Zahl zwischen 1 und 3650 sein.')
  return value
}

export async function createBackup({
  databasePath = process.env.PACE_DATABASE_PATH ?? path.resolve('data/pace.sqlite'),
  backupDir = process.env.PACE_BACKUP_DIR ?? path.resolve('data/backups'),
  retentionDays = parseRetentionDays(process.env.PACE_BACKUP_RETENTION_DAYS),
  now = new Date(),
  filename = process.env.PACE_BACKUP_FILENAME,
} = {}) {
  const sourcePath = path.resolve(databasePath)
  const destinationDir = path.resolve(backupDir)
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error(`SQLite-Datenbank nicht gefunden: ${sourcePath}`)
  fs.mkdirSync(destinationDir, { recursive: true, mode: 0o700 })
  fs.chmodSync(destinationDir, 0o700)
  const backupFilename = filename ?? `pace-${now.toISOString().replaceAll('-', '').replaceAll(':', '')}.sqlite`
  if (!SAFE_BACKUP_FILENAME.test(backupFilename)) throw new Error('PACE_BACKUP_FILENAME ist ungültig.')
  const finalPath = path.join(destinationDir, backupFilename)
  const temporaryPath = path.join(destinationDir, `.${backupFilename}.${process.pid}.tmp`)
  if (fs.existsSync(finalPath)) throw new Error(`Backup existiert bereits: ${finalPath}`)

  try {
    fs.closeSync(fs.openSync(temporaryPath, 'wx', 0o600))
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
    try {
      await source.backup(temporaryPath)
    } finally {
      source.close()
    }
    const verification = new Database(temporaryPath, { readonly: true, fileMustExist: true })
    try {
      const result = verification.pragma('integrity_check', { simple: true })
      if (result !== 'ok') throw new Error(`Backup-Integritätsprüfung fehlgeschlagen: ${String(result)}`)
    } finally {
      verification.close()
    }
    fs.chmodSync(temporaryPath, 0o600)
    fs.linkSync(temporaryPath, finalPath)
    fs.unlinkSync(temporaryPath)
    fs.chmodSync(finalPath, 0o600)
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath)
    throw error
  }

  const cutoff = now.getTime() - retentionDays * 86_400_000
  const removed = []
  for (const entry of fs.readdirSync(destinationDir, { withFileTypes: true })) {
    if (!entry.isFile() || !DAILY_BACKUP_PATTERN.test(entry.name) || entry.name === backupFilename) continue
    const candidate = path.join(destinationDir, entry.name)
    if (fs.statSync(candidate).mtimeMs < cutoff) {
      fs.unlinkSync(candidate)
      removed.push(entry.name)
    }
  }
  return { path: finalPath, removed }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createBackup().then(({ path: backupPath, removed }) => {
    console.log(`Pace-Backup erstellt: ${backupPath}`)
    console.log(`Abgelaufene Backups entfernt: ${removed.length}`)
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
