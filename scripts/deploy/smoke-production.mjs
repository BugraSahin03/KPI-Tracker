#!/usr/bin/env node
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createBackup } from '../backup/create-backup.mjs'

const root = process.cwd()
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-production-smoke-'))
const databasePath = path.join(temporaryDirectory, 'pace.sqlite')
const port = 43179
const baseUrl = `http://127.0.0.1:${port}`
const productionEnvironment = {
  ...process.env,
  NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
  PACE_DATABASE_PATH: databasePath, PACE_DIST_PATH: path.join(root, 'dist'),
  PACE_PUBLIC_ORIGIN: 'https://pace-smoke.example.ts.net',
  PACE_ALLOWED_TAILSCALE_USERS: 'bugra@example.com,sena@example.com',
  PACE_GOOGLE_HEALTH_ENABLED: 'false', PACE_TIME_ZONE: 'Europe/Berlin',
}
let child

async function start() {
  child = spawn(process.execPath, ['dist-server/server/index.js'], { cwd: root, env: productionEnvironment, stdio: ['ignore', 'pipe', 'pipe'] })
  let diagnostics = ''
  child.stdout.on('data', (chunk) => { diagnostics += chunk })
  child.stderr.on('data', (chunk) => { diagnostics += chunk })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server wurde vorzeitig beendet:\n${diagnostics}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return response.json()
    } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Healthcheck-Timeout:\n${diagnostics}`)
}

async function stop() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Shutdown-Timeout')), 15_000)
    child.once('exit', (code) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Shutdown-Code ${code}`)) })
  })
}

try {
  const health = await start()
  if (health.status !== 'ok' || health.sqliteReady !== true || health.schemaVersion !== 6) throw new Error('Unerwartete Health-Antwort.')
  const denied = await fetch(`${baseUrl}/api/data`)
  if (denied.status !== 403) throw new Error('API ohne Tailscale-Identität wurde nicht abgelehnt.')
  const headers = { 'Tailscale-User-Login': 'bugra@example.com' }
  const google = await fetch(`${baseUrl}/api/integrations/google-health/status`, { headers })
  if (google.status !== 404) throw new Error('Google-Route ist nicht deaktiviert.')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())
  const missingOrigin = await fetch(`${baseUrl}/api/mutations`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: 'profile-bugra', mutation: { id: 'missing-origin', kind: 'entry.set', entry: { goalId: 'protein', date: today, status: 'done', updatedAt: new Date().toISOString() } } }),
  })
  if (missingOrigin.status !== 403) throw new Error('Production-Schreibzugriff ohne Origin wurde nicht abgelehnt.')
  const mutation = await fetch(`${baseUrl}/api/mutations`, {
    method: 'POST',
    headers: { ...headers, Origin: 'https://pace-smoke.example.ts.net', 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: 'profile-bugra', mutation: { id: 'smoke-body', kind: 'body.upsert', metric: { id: 'smoke-body', date: today, weightKg: 81, createdAt: new Date().toISOString() } } }),
  })
  if (!mutation.ok) throw new Error(`Smoke-Mutation fehlgeschlagen: ${await mutation.text()}`)
  await stop()
  await start()
  const restarted = await fetch(`${baseUrl}/api/data?profileId=profile-bugra`, { headers }).then((response) => response.json())
  if (!restarted.data.bodyMetrics.some((metric) => metric.id === 'smoke-body')) throw new Error('Mutation blieb nach Neustart nicht erhalten.')
  const backup = await createBackup({ databasePath, backupDir: path.join(temporaryDirectory, 'backups'), retentionDays: 30 })
  const verification = new Database(backup.path, { readonly: true })
  if (verification.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup ist nicht integer.')
  if (verification.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version !== 6) throw new Error('Backup hat unerwartetes Schema.')
  verification.close()
  console.log('Production-Smoke, Persistenz, Health, Google-404 und Backup: ok')
} finally {
  await stop().catch(() => {})
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
