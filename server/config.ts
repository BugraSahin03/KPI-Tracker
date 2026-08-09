import 'dotenv/config'
import path from 'node:path'
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from './time.js'

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const raw = env[key]
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} muss eine ganze Zahl zwischen ${min} und ${max} sein.`)
  return value
}

function optionalNumber(env: NodeJS.ProcessEnv, key: string, min: number, max: number) {
  const raw = env[key]
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${key} muss eine Zahl zwischen ${min} und ${max} sein.`)
  return value
}

function booleanFlag(env: NodeJS.ProcessEnv, key: string, fallback = false) {
  const raw = env[key]
  if (raw === undefined || raw === '') return fallback
  if (['true', '1', 'yes', 'on'].includes(raw.toLowerCase())) return true
  if (['false', '0', 'no', 'off'].includes(raw.toLowerCase())) return false
  throw new Error(`${key} muss true oder false sein.`)
}

function tailscaleUsers(env: NodeJS.ProcessEnv) {
  const plural = env.PACE_ALLOWED_TAILSCALE_USERS
  const legacy = env.PACE_ALLOWED_TAILSCALE_USER
  if (plural !== undefined && legacy?.trim()) throw new Error('PACE_ALLOWED_TAILSCALE_USERS und die alte Singular-Variable dürfen nicht gleichzeitig gesetzt sein.')
  const raw = plural ?? legacy
  if (raw === undefined) return []
  if (!raw.trim()) throw new Error('PACE_ALLOWED_TAILSCALE_USERS darf nicht leer sein.')
  const tokens = raw.split(',').map((token) => token.trim())
  if (tokens.some((token) => !token || token.length > 254 || !/^[^\s,@]+@[^\s,@]+$/.test(token))) {
    throw new Error('PACE_ALLOWED_TAILSCALE_USERS enthält eine leere oder ungültige Tailscale-Identität.')
  }
  return [...new Set(tokens)]
}

function isLoopback(host: string) {
  return ['127.0.0.1', '::1', 'localhost'].includes(host.toLowerCase())
}

export function parseConfig(env: NodeJS.ProcessEnv = process.env, root = process.cwd()) {
  const production = env.NODE_ENV === 'production'
  const host = env.HOST ?? '127.0.0.1'
  let publicOrigin: string | undefined
  if (env.PACE_PUBLIC_ORIGIN) {
    let url: URL
    try { url = new URL(env.PACE_PUBLIC_ORIGIN) } catch { throw new Error('PACE_PUBLIC_ORIGIN muss eine vollständige gültige URL sein.') }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('PACE_PUBLIC_ORIGIN muss HTTPS verwenden.')
    if (url.username || url.password) throw new Error('PACE_PUBLIC_ORIGIN darf keine Zugangsdaten enthalten.')
    if (url.pathname !== '/' || url.search || url.hash) throw new Error('PACE_PUBLIC_ORIGIN darf keinen Pfad, Query oder Hash enthalten.')
    publicOrigin = url.origin
  }
  const tokenEncryptionKey = env.PACE_TOKEN_ENCRYPTION_KEY
  if (tokenEncryptionKey && (!/^[A-Za-z0-9+/]+={0,2}$/.test(tokenEncryptionKey) || Buffer.from(tokenEncryptionKey, 'base64').length !== 32)) throw new Error('PACE_TOKEN_ENCRYPTION_KEY muss genau 32 Byte Base64 enthalten.')
  const allowedTailscaleUsers = tailscaleUsers(env)
  const googleHealthEnabled = booleanFlag(env, 'PACE_GOOGLE_HEALTH_ENABLED', false)
  if (production) {
    if (!isLoopback(host)) throw new Error('HOST muss in Produktion auf Loopback gebunden sein.')
    if (!publicOrigin || !publicOrigin.startsWith('https://')) throw new Error('PACE_PUBLIC_ORIGIN muss in Produktion als HTTPS-URL gesetzt sein.')
    if (!allowedTailscaleUsers.length) throw new Error('PACE_ALLOWED_TAILSCALE_USERS muss in Produktion gesetzt sein.')
    if (googleHealthEnabled) throw new Error('PACE_GOOGLE_HEALTH_ENABLED muss für diesen Release false sein.')
  }
  return {
    production, port: integer(env, 'PORT', 4173, 1, 65535), host,
    databasePath: path.resolve(env.PACE_DATABASE_PATH ?? path.join(root, 'data', 'pace.sqlite')),
    distPath: path.resolve(env.PACE_DIST_PATH ?? path.join(root, 'dist')),
    publicOrigin, googleClientId: env.GOOGLE_HEALTH_CLIENT_ID, googleClientSecret: env.GOOGLE_HEALTH_CLIENT_SECRET,
    googleHealthEnabled,
    tokenEncryptionKey, pollingMinutes: integer(env, 'GOOGLE_HEALTH_POLL_MINUTES', 15, 1, 1440),
    initialSyncDays: integer(env, 'GOOGLE_HEALTH_INITIAL_SYNC_DAYS', 365, 1, 3650),
    lookbackDays: integer(env, 'GOOGLE_HEALTH_LOOKBACK_DAYS', 7, 1, 90),
    heightCm: optionalNumber(env, 'PACE_HEIGHT_CM', 50, 300),
    allowedTailscaleUsers,
    timeZone: normalizeTimeZone(env.PACE_TIME_ZONE ?? DEFAULT_TIME_ZONE),
  }
}

export const config = parseConfig()

export function googleHealthConfigured() {
  return Boolean(
    config.googleHealthEnabled && config.publicOrigin && config.googleClientId && config.googleClientSecret && config.tokenEncryptionKey,
  )
}
