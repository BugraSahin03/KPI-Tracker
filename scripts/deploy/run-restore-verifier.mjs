#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const [phase, currentArgument, targetArgument, databaseArgument] = process.argv.slice(2)
if (!['input', 'final', 'safety', 'rollback'].includes(phase ?? '')) throw new Error('Ungültige Restore-Prüfphase.')
if (!currentArgument || !targetArgument || !databaseArgument) throw new Error('Restore-Prüfargumente fehlen.')
const releasesRoot = fs.realpathSync(process.env.PACE_RELEASES_DIR ?? '/opt/pace/releases')

function safeRelease(argument) {
  const resolved = fs.realpathSync(argument)
  if (path.dirname(resolved) !== releasesRoot || !fs.statSync(resolved).isDirectory()) throw new Error('Verifier-Release liegt außerhalb des sicheren Release-Roots.')
  const verifier = path.join(resolved, 'scripts/backup/verify-database.mjs')
  if (!fs.statSync(verifier).isFile()) throw new Error('Release-Verifier fehlt.')
  return { release: resolved, verifier }
}

const current = safeRelease(currentArgument)
const target = safeRelease(targetArgument)
const selected = phase === 'safety' || phase === 'rollback' ? current : target
const result = spawnSync(process.execPath, [selected.verifier, path.resolve(databaseArgument)], { stdio: 'inherit', env: process.env })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
