import { createApp } from './app.js'
import { config } from './config.js'
import { PaceDatabase } from './db.js'
import { GoogleHealthService } from './google-health.js'

const database = new PaceDatabase()
const googleHealth = new GoogleHealthService(database)
const app = createApp(database, googleHealth)
const server = app.listen(config.port, config.host, () => {
  console.log(`Pace läuft auf http://${config.host}:${config.port}`)
})

const interval = config.googleHealthEnabled ? setInterval(() => {
  googleHealth.sync().catch((error) => console.error('Google Health Sync:', error))
}, config.pollingMinutes * 60_000) : undefined
interval?.unref()

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Pace beendet sich kontrolliert (${signal}).`)
  if (interval) clearInterval(interval)
  const forceTimer = setTimeout(() => {
    console.error('Graceful Shutdown überschritt 12 Sekunden; Prozess wird beendet.')
    try { database.close() } catch { /* already closed or busy */ }
    process.exit(1)
  }, 12_000)
  forceTimer.unref()
  server.close(() => {
    clearTimeout(forceTimer)
    try { database.close() } catch { /* already closed */ }
    process.exit(0)
  })
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
