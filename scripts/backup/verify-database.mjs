#!/usr/bin/env node
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const EXPECTED_SCHEMA_VERSION = 10
const REQUIRED_TABLES = ['app_state', 'body_metrics', 'daily_entries', 'goals', 'gym_exercise_aliases', 'gym_exercises', 'gym_session_sets', 'gym_sessions', 'gym_templates', 'profiles', 'schema_migrations']

function inspectExact(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('PRAGMA quick_check ist fehlgeschlagen.')
    const foreignKeyErrors = database.pragma('foreign_key_check')
    if (foreignKeyErrors.length) throw new Error(`PRAGMA foreign_key_check meldet ${foreignKeyErrors.length} Fehler.`)
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all())
    for (const table of REQUIRED_TABLES) if (!tables.has(table)) throw new Error(`Erforderliche Tabelle fehlt: ${table}.`)
    const schemaVersion = Number(database.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get() ?? 0)
    if (schemaVersion !== EXPECTED_SCHEMA_VERSION) throw new Error(`Unerwartete Schemaversion ${schemaVersion}; erwartet ist ${EXPECTED_SCHEMA_VERSION}.`)
    if (!database.prepare('SELECT 1 FROM app_state WHERE singleton=1').get()) throw new Error('app_state ist unvollständig.')
    const profiles = database.prepare('SELECT id FROM profiles ORDER BY id').pluck().all()
    if (JSON.stringify(profiles) !== JSON.stringify(['profile-bugra', 'profile-sena'])) throw new Error('Erwartete Profile Bugra und Sena fehlen oder es existieren unerwartete Profile.')
    const missingExerciseRefs = Number(database.prepare(`SELECT
      (SELECT COUNT(*) FROM gym_template_exercises WHERE exercise_id IS NULL) +
      (SELECT COUNT(*) FROM gym_session_exercises WHERE exercise_id IS NULL)`).pluck().get() ?? 0)
    if (missingExerciseRefs) throw new Error(`${missingExerciseRefs} GYM-Zeilen besitzen keine kanonische Übungsreferenz.`)
    const crossProfileRefs = Number(database.prepare(`SELECT
      (SELECT COUNT(*) FROM gym_template_exercises row JOIN gym_exercises exercise ON exercise.id=row.exercise_id WHERE row.profile_id<>exercise.profile_id) +
      (SELECT COUNT(*) FROM gym_session_exercises row JOIN gym_exercises exercise ON exercise.id=row.exercise_id WHERE row.profile_id<>exercise.profile_id)`).pluck().get() ?? 0)
    if (crossProfileRefs) throw new Error(`${crossProfileRefs} GYM-Referenzen überschreiten Profilgrenzen.`)
  } finally {
    database.close()
  }
}

async function verifyMigrationOnCopy(databasePath) {
  const source = new Database(databasePath, { readonly: true, fileMustExist: true })
  let sourceVersion
  try {
    const hasMigrations = source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
    if (!hasMigrations) throw new Error('Keine bekannte Pace-Schemaversion gefunden.')
    sourceVersion = Number(source.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get() ?? 0)
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > EXPECTED_SCHEMA_VERSION) throw new Error(`Schemaversion ${sourceVersion} liegt außerhalb des erlaubten Migrationsbereichs 1..${EXPECTED_SCHEMA_VERSION}.`)
  } finally {
    source.close()
  }
  const temporaryPath = `${databasePath}.migration-check-${process.pid}-${Date.now()}.sqlite`
  try {
    fs.closeSync(fs.openSync(temporaryPath, 'wx', 0o600))
    const copySource = new Database(databasePath, { readonly: true, fileMustExist: true })
    try { await copySource.backup(temporaryPath) } finally { copySource.close() }
    const module = await import('../../dist-server/server/db.js')
    const migrated = new module.PaceDatabase(temporaryPath)
    try {
      const health = migrated.health()
      if (!health.sqliteReady || health.schemaVersion !== EXPECTED_SCHEMA_VERSION) throw new Error('Migrationstest auf der Kopie ist nicht health-ready.')
    } finally { migrated.close() }
    inspectExact(temporaryPath)
  } finally {
    for (const candidate of [temporaryPath, `${temporaryPath}-wal`, `${temporaryPath}-shm`]) {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate)
    }
  }
  console.log(`SQLite-Snapshot Schema ${sourceVersion} lässt sich auf Schema ${EXPECTED_SCHEMA_VERSION} migrieren: ok`)
}

const argumentsList = process.argv.slice(2)
const allowMigration = argumentsList[0] === '--allow-migrate-from'
if (allowMigration && argumentsList[1] !== '1..9') throw new Error('Erlaubter Bereich muss explizit 1..9 sein.')
const input = allowMigration ? argumentsList[2] : argumentsList[0]
if (!input || argumentsList.length !== (allowMigration ? 3 : 1)) throw new Error('Aufruf: verify-database.mjs [--allow-migrate-from 1..9] <sqlite-pfad>')
const databasePath = path.resolve(input)
if (!fs.existsSync(databasePath) || !fs.statSync(databasePath).isFile()) throw new Error('SQLite-Datei fehlt oder ist keine reguläre Datei.')
if (allowMigration) await verifyMigrationOnCopy(databasePath)
else {
  inspectExact(databasePath)
  console.log('SQLite Schema 10, Profile, quick_check und foreign_key_check: ok')
}
