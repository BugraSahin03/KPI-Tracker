import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { DEFAULT_PROFILE_ID, type AppData, type BodyMetric, type DataMutation, type GymSession, type GymTemplate, type Profile, type ProfileId } from '../src/types.js'
import { legacyGymSetId } from '../src/lib/storage.js'
import { config } from './config.js'
import { dateKeyInTimeZone } from './time.js'

type Row = Record<string, unknown>

export class PaceDatabase {
  readonly db: Database.Database
  private readonly now: () => Date
  private readonly timeZone: string

  constructor(databasePath = config.databasePath, options: { now?: () => Date; timeZone?: string } = {}) {
    this.now = options.now ?? (() => new Date())
    this.timeZone = options.timeZone ?? config.timeZone
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    this.db = new Database(databasePath)
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.migrate()
    this.seed()
  }

  private migrate() {
    const migrationDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
    const files = fs.readdirSync(migrationDirectory).filter((file) => /^\d+_.*\.sql$/.test(file)).sort()
    for (const file of files) {
      const version = Number(file.split('_')[0])
      const applied = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() &&
        this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)
      if (applied) continue
      const sql = fs.readFileSync(path.join(migrationDirectory, file), 'utf8')
      this.db.transaction(() => {
        this.db.exec(sql)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString())
      })()
    }
  }

  private seed() {
    const state = this.db.prepare('SELECT singleton FROM app_state WHERE singleton = 1').get()
    if (state) return
    const today = dateKeyInTimeZone(this.now(), this.timeZone)
    const seededAt = this.now().toISOString()
    const data: AppData = {
      version: 3,
      goals: [
        { id: 'protein', name: 'Protein', unit: 'g', target: 120, icon: 'protein', color: '#c6ff3d', active: true, createdAt: today, activityPeriods: [{ start: today }] },
        { id: 'water', name: 'Wasser', unit: 'L', target: 2, icon: 'water', color: '#4dc5ff', active: true, createdAt: today, activityPeriods: [{ start: today }] },
      ],
      entries: [],
      bodyMetrics: [],
      gymTemplates: ['Push', 'Pull', 'Beine'].map((name) => ({
        id: `gym-template-${name.toLowerCase()}`, name, createdAt: seededAt, updatedAt: seededAt, exercises: [],
      })),
      gymSessions: [],
    }
    this.replaceData(DEFAULT_PROFILE_ID, data, 0, true)
  }

  listProfiles(): Profile[] {
    return (this.db.prepare('SELECT id,name,initial,color FROM profiles ORDER BY position').all() as Row[]).map((row) => ({
      id: String(row.id) as ProfileId, name: String(row.name) as Profile['name'], initial: String(row.initial) as Profile['initial'], color: String(row.color),
    }))
  }

  assertProfile(profileId: string): asserts profileId is ProfileId {
    if (!this.db.prepare('SELECT 1 FROM profiles WHERE id=?').get(profileId)) {
      const error = new Error('Unbekanntes Profil.')
      Object.assign(error, { code: 'PROFILE_NOT_FOUND' })
      throw error
    }
  }

  getRevision() {
    return Number((this.db.prepare('SELECT revision FROM app_state WHERE singleton = 1').get() as Row | undefined)?.revision ?? 0)
  }

  getData(profileId: string = DEFAULT_PROFILE_ID): AppData {
    this.assertProfile(profileId)
    const goals = (this.db.prepare('SELECT * FROM goals WHERE profile_id=? ORDER BY rowid').all(profileId) as Row[]).map((row) => ({
      id: String(row.id), name: String(row.name), unit: String(row.unit), target: Number(row.target),
      icon: String(row.icon) as AppData['goals'][number]['icon'], color: String(row.color), active: Boolean(row.active),
      createdAt: String(row.created_at), activityPeriods: JSON.parse(String(row.activity_periods_json)),
    }))
    const entries = (this.db.prepare('SELECT * FROM daily_entries WHERE profile_id=? ORDER BY date, goal_id').all(profileId) as Row[]).map((row) => ({
      goalId: String(row.goal_id), date: String(row.date), status: String(row.status) as 'done' | 'failed', updatedAt: String(row.updated_at),
    }))
    const bodyMetrics = (this.db.prepare('SELECT * FROM body_metrics WHERE profile_id=? ORDER BY date DESC, julianday(COALESCE(measured_at, created_at)) DESC, id DESC').all(profileId) as Row[]).map(rowToBodyMetric)
    const gymTemplates = (this.db.prepare('SELECT * FROM gym_templates WHERE profile_id=? ORDER BY rowid').all(profileId) as Row[]).map((row) => rowToGymTemplate(this.db, row, profileId))
    const gymSessions = (this.db.prepare('SELECT * FROM gym_sessions WHERE profile_id=? ORDER BY date DESC, completed_at DESC').all(profileId) as Row[]).map((row) => rowToGymSession(this.db, row, profileId))
    return { version: 3, goals, entries, bodyMetrics, gymTemplates, gymSessions }
  }

  private hasExactSeed() {
    const state = this.db.prepare('SELECT revision, seed_pristine FROM app_state WHERE singleton=1').get() as Row | undefined
    if (!state || Number(state.revision) !== 0 || Number(state.seed_pristine) !== 1) return false
    const data = this.getData(DEFAULT_PROFILE_ID)
    if (data.entries.length || data.bodyMetrics.length || data.gymSessions.length || data.goals.length !== 2 || data.gymTemplates.length !== 3) return false
    const expected = new Map([
      ['protein', { name: 'Protein', unit: 'g', target: 120, icon: 'protein', color: '#c6ff3d' }],
      ['water', { name: 'Wasser', unit: 'L', target: 2, icon: 'water', color: '#4dc5ff' }],
    ])
    const goalsMatch = data.goals.every((goal) => {
      const seed = expected.get(goal.id)
      return seed && goal.active && goal.name === seed.name && goal.unit === seed.unit && goal.target === seed.target &&
        goal.icon === seed.icon && goal.color === seed.color && goal.activityPeriods.length === 1 &&
        goal.activityPeriods[0]?.start === goal.createdAt && goal.activityPeriods[0]?.end === undefined
    })
    const templatesMatch = data.gymTemplates.every((template) =>
      ['Push', 'Pull', 'Beine'].includes(template.name) && template.exercises.length === 0)
    return goalsMatch && templatesMatch
  }

  importIfPristine(profileIdOrData: string | AppData, maybeData?: AppData) {
    const profileId = typeof profileIdOrData === 'string' ? profileIdOrData : DEFAULT_PROFILE_ID
    const data = typeof profileIdOrData === 'string' ? maybeData! : profileIdOrData
    this.assertProfile(profileId)
    if (profileId !== DEFAULT_PROFILE_ID) {
      const error = new Error('Lokaler Import ist ausschließlich für Bugra vorgesehen.')
      Object.assign(error, { code: 'IMPORT_PROFILE_FORBIDDEN' })
      throw error
    }
    return this.db.transaction(() => {
      if (!this.hasExactSeed()) {
        const error = new Error('Server enthält bereits bearbeitete Daten. Import wurde sicherheitshalber nicht ausgeführt.')
        Object.assign(error, { code: 'IMPORT_CONFLICT' })
        throw error
      }
      return this.replaceData(profileId, data, 0)
    })()
  }

  replaceData(profileIdOrData: string | AppData, dataOrRevision: AppData | number, revisionOrInitializing: number | boolean = 0, maybeInitializing = false) {
    const profileId = typeof profileIdOrData === 'string' ? profileIdOrData : DEFAULT_PROFILE_ID
    const data = typeof profileIdOrData === 'string' ? dataOrRevision as AppData : profileIdOrData
    const expectedRevision = typeof profileIdOrData === 'string' ? revisionOrInitializing as number : dataOrRevision as number
    const initializing = typeof profileIdOrData === 'string' ? maybeInitializing : Boolean(revisionOrInitializing)
    this.assertProfile(profileId)
    return this.db.transaction(() => {
      const current = this.getRevision()
      if (!initializing && current !== expectedRevision) {
        const error = new Error('Die Daten wurden zwischenzeitlich geändert. Bitte neu laden.')
        Object.assign(error, { code: 'REVISION_CONFLICT' })
        throw error
      }
      const pointLinks = this.db.prepare('SELECT * FROM integration_data_points WHERE profile_id=?').all(profileId) as Row[]
      const rawByMetric = new Map((this.db.prepare('SELECT id, raw_json FROM body_metrics WHERE profile_id=? AND raw_json IS NOT NULL').all(profileId) as Row[]).map((row) => [String(row.id), String(row.raw_json)]))
      this.db.prepare('DELETE FROM daily_entries WHERE profile_id=?').run(profileId)
      this.db.prepare('DELETE FROM goals WHERE profile_id=?').run(profileId)
      this.db.prepare('DELETE FROM body_metrics WHERE profile_id=?').run(profileId)
      this.db.prepare('DELETE FROM gym_sessions WHERE profile_id=?').run(profileId)
      this.db.prepare('DELETE FROM gym_templates WHERE profile_id=?').run(profileId)
      const insertGoal = this.db.prepare(`INSERT INTO goals
        (profile_id,id,name,unit,target,icon,color,active,created_at,activity_periods_json) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      for (const goal of data.goals) insertGoal.run(profileId, goal.id, goal.name, goal.unit, goal.target, goal.icon, goal.color, goal.active ? 1 : 0, goal.createdAt, JSON.stringify(goal.activityPeriods))
      const insertEntry = this.db.prepare('INSERT INTO daily_entries(profile_id,goal_id,date,status,updated_at) VALUES (?,?,?,?,?)')
      for (const entry of data.entries) insertEntry.run(profileId, entry.goalId, entry.date, entry.status, entry.updatedAt)
      const insertMetric = this.db.prepare(`INSERT INTO body_metrics
        (profile_id,id,date,weight_kg,muscle_mass_kg,body_fat_percent,bmi,lean_body_mass_kg,source,measured_at,external_id,created_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      for (const metric of data.bodyMetrics) insertMetric.run(
        profileId, metric.id, metric.date, metric.weightKg ?? null, metric.muscleMassKg ?? null, metric.bodyFatPercent ?? null,
        metric.bmi ?? null, metric.leanBodyMassKg ?? null, metric.source ?? 'manual', metric.measuredAt ?? null,
        metric.externalId ?? null, metric.createdAt, rawByMetric.get(metric.id) ?? null,
      )
      const insertTemplate = this.db.prepare('INSERT INTO gym_templates(profile_id,id,name,created_at,updated_at) VALUES (?,?,?,?,?)')
      const insertTemplateExercise = this.db.prepare(`INSERT INTO gym_template_exercises
        (profile_id,id,template_id,name,sets,target_weight_kg,target_reps,position) VALUES (?,?,?,?,?,?,?,?)`)
      for (const template of data.gymTemplates) {
        insertTemplate.run(profileId, template.id, template.name, template.createdAt, template.updatedAt)
        for (const exercise of template.exercises) insertTemplateExercise.run(
          profileId, exercise.id, template.id, exercise.name, exercise.sets, exercise.targetWeightKg ?? null, exercise.targetReps, exercise.position,
        )
      }
      for (const session of data.gymSessions) this.insertGymSession(profileId, session)
      const restorePoint = this.db.prepare('INSERT OR IGNORE INTO integration_data_points(provider,external_id,profile_id,body_metric_id,imported_at) VALUES (?,?,?,?,?)')
      const metricIds = new Set(data.bodyMetrics.map((metric) => metric.id))
      for (const link of pointLinks) {
        if (metricIds.has(String(link.body_metric_id))) restorePoint.run(link.provider, link.external_id, profileId, link.body_metric_id, link.imported_at)
      }
      const next = initializing ? 0 : current + 1
      this.db.prepare(`INSERT INTO app_state(singleton,revision,initialized_at,seed_pristine) VALUES (1,?,?,?)
        ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision, seed_pristine=excluded.seed_pristine`).run(next, new Date().toISOString(), initializing ? 1 : 0)
      return next
    })()
  }

  applyMutation(profileIdOrMutation: string | DataMutation, maybeMutation?: DataMutation) {
    const profileId = typeof profileIdOrMutation === 'string' ? profileIdOrMutation : DEFAULT_PROFILE_ID
    const mutation = typeof profileIdOrMutation === 'string' ? maybeMutation! : profileIdOrMutation
    this.assertProfile(profileId)
    return this.db.transaction(() => {
      const receipt = this.db.prepare('SELECT 1 FROM mutation_receipts WHERE mutation_id=? AND profile_id=?').get(mutation.id, profileId)
      if (receipt) return { applied: false, revision: this.getRevision() }
      if (mutation.kind === 'gym.session.complete' && this.db.prepare('SELECT 1 FROM gym_sessions WHERE profile_id=? AND id=?').get(profileId, mutation.session.id)) {
        this.db.prepare('INSERT INTO mutation_receipts(mutation_id,kind,applied_at,profile_id) VALUES (?,?,?,?)').run(mutation.id, mutation.kind, new Date().toISOString(), profileId)
        return { applied: false, revision: this.getRevision() }
      }
      if (mutation.kind === 'entry.set') {
        if (!this.db.prepare('SELECT 1 FROM goals WHERE profile_id=? AND id=?').get(profileId, mutation.entry.goalId)) throw integrityError()
        if (mutation.entry.status === 'open') this.db.prepare('DELETE FROM daily_entries WHERE profile_id=? AND goal_id=? AND date=?').run(profileId, mutation.entry.goalId, mutation.entry.date)
        else this.db.prepare(`INSERT INTO daily_entries(profile_id,goal_id,date,status,updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(profile_id,goal_id,date) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`).run(profileId, mutation.entry.goalId, mutation.entry.date, mutation.entry.status, mutation.entry.updatedAt)
      } else if (mutation.kind === 'goal.upsert') {
        const goal = mutation.goal
        this.db.prepare(`INSERT INTO goals(profile_id,id,name,unit,target,icon,color,active,created_at,activity_periods_json) VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(profile_id,id) DO UPDATE SET name=excluded.name,unit=excluded.unit,target=excluded.target,icon=excluded.icon,color=excluded.color,active=excluded.active,created_at=excluded.created_at,activity_periods_json=excluded.activity_periods_json`).run(
          profileId, goal.id, goal.name, goal.unit, goal.target, goal.icon, goal.color, goal.active ? 1 : 0, goal.createdAt, JSON.stringify(goal.activityPeriods))
      } else if (mutation.kind === 'goal.delete') {
        this.db.prepare('DELETE FROM goals WHERE profile_id=? AND id=?').run(profileId, mutation.goalId)
      } else if (mutation.kind === 'body.upsert') {
        const metric = mutation.metric
        this.db.prepare(`INSERT INTO body_metrics(profile_id,id,date,weight_kg,muscle_mass_kg,body_fat_percent,bmi,lean_body_mass_kg,source,measured_at,external_id,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,id) DO UPDATE SET date=excluded.date,weight_kg=excluded.weight_kg,muscle_mass_kg=excluded.muscle_mass_kg,
          body_fat_percent=excluded.body_fat_percent,bmi=excluded.bmi,lean_body_mass_kg=excluded.lean_body_mass_kg,source=excluded.source,
          measured_at=excluded.measured_at,external_id=excluded.external_id`).run(
          profileId, metric.id, metric.date, metric.weightKg ?? null, metric.muscleMassKg ?? null, metric.bodyFatPercent ?? null, metric.bmi ?? null, metric.leanBodyMassKg ?? null, metric.source ?? 'manual', metric.measuredAt ?? null,
          metric.externalId ?? null, metric.createdAt)
      } else if (mutation.kind === 'body.delete') {
        this.db.prepare(`INSERT OR IGNORE INTO integration_ignored_points(provider,external_id,ignored_at)
          SELECT provider,external_id,? FROM integration_data_points WHERE profile_id=? AND body_metric_id=?`).run(new Date().toISOString(), profileId, mutation.metricId)
        this.db.prepare('DELETE FROM body_metrics WHERE profile_id=? AND id=?').run(profileId, mutation.metricId)
      } else if (mutation.kind === 'gym.template.upsert') {
        this.upsertGymTemplate(profileId, mutation.template)
      } else if (mutation.kind === 'gym.template.delete') {
        this.db.prepare('UPDATE gym_sessions SET template_id=NULL WHERE profile_id=? AND template_id=?').run(profileId, mutation.templateId)
        this.db.prepare('DELETE FROM gym_templates WHERE profile_id=? AND id=?').run(profileId, mutation.templateId)
      } else if (mutation.kind === 'gym.session.complete') {
        this.insertGymSession(profileId, mutation.session)
      } else if (mutation.kind === 'gym.session.delete') {
        this.db.prepare('DELETE FROM gym_sessions WHERE profile_id=? AND id=?').run(profileId, mutation.sessionId)
      }
      this.db.prepare('INSERT INTO mutation_receipts(mutation_id,kind,applied_at,profile_id) VALUES (?,?,?,?)').run(mutation.id, mutation.kind, new Date().toISOString(), profileId)
      this.db.prepare('UPDATE app_state SET revision=revision+1,seed_pristine=0 WHERE singleton=1').run()
      return { applied: true, revision: this.getRevision() }
    })()
  }

  private upsertGymTemplate(profileId: string, template: GymTemplate) {
    this.db.prepare(`INSERT INTO gym_templates(profile_id,id,name,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(profile_id,id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`).run(
      profileId, template.id, template.name, template.createdAt, template.updatedAt,
    )
    this.db.prepare('DELETE FROM gym_template_exercises WHERE profile_id=? AND template_id=?').run(profileId, template.id)
    const insert = this.db.prepare(`INSERT INTO gym_template_exercises
      (profile_id,id,template_id,name,sets,target_weight_kg,target_reps,position) VALUES (?,?,?,?,?,?,?,?)`)
    for (const exercise of template.exercises) insert.run(
      profileId, exercise.id, template.id, exercise.name, exercise.sets, exercise.targetWeightKg ?? null, exercise.targetReps, exercise.position,
    )
  }

  private insertGymSession(profileId: string, session: GymSession) {
    this.db.prepare(`INSERT INTO gym_sessions(profile_id,id,template_id,template_name,date,started_at,completed_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      profileId, session.id, session.templateId && this.db.prepare('SELECT 1 FROM gym_templates WHERE profile_id=? AND id=?').get(profileId, session.templateId) ? session.templateId : null,
      session.templateName, session.date, session.startedAt, session.completedAt,
    )
    const insert = this.db.prepare(`INSERT INTO gym_session_exercises
      (profile_id,id,session_id,template_exercise_id,name,sets,weight_kg,reps,position) VALUES (?,?,?,?,?,?,?,?,?)`)
    const insertSet = this.db.prepare(`INSERT INTO gym_session_sets
      (profile_id,id,session_exercise_id,set_number,weight_kg,reps) VALUES (?,?,?,?,?,?)`)
    for (const exercise of session.exercises) insert.run(
      profileId, exercise.id, session.id, exercise.templateExerciseId ?? null, exercise.name, exercise.sets,
      exercise.weightKg ?? null, exercise.reps, exercise.position,
    )
    for (const exercise of session.exercises) {
      const performedSets = exercise.performedSets ?? Array.from({ length: exercise.sets }, (_, index) => ({
        id: legacyGymSetId(exercise.id, index + 1), setNumber: index + 1, weightKg: exercise.weightKg, reps: exercise.reps,
      }))
      for (const set of performedSets) insertSet.run(profileId, set.id, exercise.id, set.setNumber, set.weightKg ?? null, set.reps)
    }
  }

  upsertGooglePoint(point: GoogleMetricPoint) {
    return this.db.transaction(() => {
      const ignored = this.db.prepare('SELECT 1 FROM integration_ignored_points WHERE provider=? AND external_id=?').get('google-health', point.externalId)
      if (ignored) return { inserted: false, metricId: '' }
      const known = this.db.prepare('SELECT body_metric_id FROM integration_data_points WHERE provider=? AND external_id=?').get('google-health', point.externalId) as Row | undefined
      if (known) return { inserted: false, metricId: String(known.body_metric_id) }
      const measuredMs = Date.parse(point.measuredAt)
      const candidates = this.db.prepare('SELECT * FROM body_metrics WHERE profile_id=? AND date=?').all(DEFAULT_PROFILE_ID, point.date) as Row[]
      const timedMatch = candidates.find((row) => row.measured_at && Math.abs(Date.parse(String(row.measured_at)) - measuredMs) <= 5 * 60_000)
      const untimedManual = candidates.find((row) => !row.measured_at && ['manual', 'local-import'].includes(String(row.source)))
      const match = timedMatch ?? untimedManual
      const id = match ? String(match.id) : `google-${createHash('sha256').update(point.externalId).digest('hex').slice(0, 24)}`
      if (match) {
        this.db.prepare(`UPDATE body_metrics SET weight_kg=COALESCE(?,weight_kg), body_fat_percent=COALESCE(?,body_fat_percent),
          measured_at=?, source=CASE WHEN muscle_mass_kg IS NULL THEN 'google-health' ELSE 'mixed' END,
          raw_json=?, bmi=COALESCE(?,bmi), lean_body_mass_kg=COALESCE(?,lean_body_mass_kg) WHERE profile_id=? AND id=?`).run(
          point.weightKg ?? null, point.bodyFatPercent ?? null, point.measuredAt, JSON.stringify(point.raw),
          point.bmi ?? null, point.leanBodyMassKg ?? null, DEFAULT_PROFILE_ID, id,
        )
      } else {
        this.db.prepare(`INSERT INTO body_metrics
          (profile_id,id,date,weight_kg,body_fat_percent,bmi,lean_body_mass_kg,source,measured_at,created_at,raw_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(DEFAULT_PROFILE_ID, id, point.date, point.weightKg ?? null, point.bodyFatPercent ?? null,
          point.bmi ?? null, point.leanBodyMassKg ?? null, 'google-health', point.measuredAt, new Date().toISOString(), JSON.stringify(point.raw))
      }
      const combined = this.db.prepare('SELECT weight_kg, body_fat_percent FROM body_metrics WHERE profile_id=? AND id=?').get(DEFAULT_PROFILE_ID, id) as Row
      const weight = combined.weight_kg == null ? undefined : Number(combined.weight_kg)
      const fat = combined.body_fat_percent == null ? undefined : Number(combined.body_fat_percent)
      const lean = weight !== undefined && fat !== undefined ? weight * (1 - fat / 100) : null
      const heightM = config.heightCm && Number.isFinite(config.heightCm) ? config.heightCm / 100 : undefined
      const bmi = weight !== undefined && heightM ? weight / (heightM * heightM) : null
      this.db.prepare('UPDATE body_metrics SET lean_body_mass_kg=COALESCE(?,lean_body_mass_kg), bmi=COALESCE(?,bmi) WHERE profile_id=? AND id=?').run(lean, bmi, DEFAULT_PROFILE_ID, id)
      this.db.prepare('INSERT INTO integration_data_points(provider,external_id,profile_id,body_metric_id,imported_at) VALUES (?,?,?,?,?)').run('google-health', point.externalId, DEFAULT_PROFILE_ID, id, new Date().toISOString())
      this.db.prepare('UPDATE app_state SET revision=revision+1,seed_pristine=0 WHERE singleton=1').run()
      return { inserted: true, metricId: id }
    })()
  }

  getIntegration() {
    return this.db.prepare("SELECT * FROM integrations WHERE provider='google-health'").get() as Row | undefined
  }

  updateIntegration(values: Record<string, string | null>) {
    const now = new Date().toISOString()
    this.db.prepare("INSERT OR IGNORE INTO integrations(provider,updated_at) VALUES ('google-health',?)").run(now)
    const allowed: Record<string, string> = {
      accessTokenEncrypted: 'access_token_encrypted', refreshTokenEncrypted: 'refresh_token_encrypted', tokenExpiresAt: 'token_expires_at',
      oauthState: 'oauth_state', oauthStateExpiresAt: 'oauth_state_expires_at', syncCursor: 'sync_cursor', lastSyncAt: 'last_sync_at',
      lastSyncError: 'last_sync_error', connectedAt: 'connected_at',
    }
    for (const [key, value] of Object.entries(values)) {
      const column = allowed[key]
      if (column) this.db.prepare(`UPDATE integrations SET ${column}=?, updated_at=? WHERE provider='google-health'`).run(value, now)
    }
  }

  addOauthState(stateHash: string, expiresAt: string) {
    this.db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(new Date().toISOString())
    this.db.prepare('INSERT INTO oauth_states(state_hash,expires_at,created_at) VALUES (?,?,?)').run(stateHash, expiresAt, new Date().toISOString())
  }

  consumeOauthState(stateHash: string) {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT expires_at FROM oauth_states WHERE state_hash=?').get(stateHash) as Row | undefined
      this.db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(stateHash)
      return Boolean(row && Date.parse(String(row.expires_at)) >= Date.now())
    })()
  }

  disconnectIntegration() {
    this.db.prepare("DELETE FROM integrations WHERE provider='google-health'").run()
  }

  health() {
    const quickCheck = String((this.db.pragma('quick_check', { simple: true }) as string | undefined) ?? '')
    const schemaVersion = Number((this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as Row | undefined)?.version ?? 0)
    const profileCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM profiles WHERE id IN ('profile-bugra','profile-sena')").get() as Row).count)
    const foreignKeyErrors = (this.db.pragma('foreign_key_check') as unknown[]).length
    return { sqliteReady: quickCheck === 'ok' && profileCount === 2 && schemaVersion === EXPECTED_SCHEMA_VERSION && foreignKeyErrors === 0, schemaVersion }
  }

  close() { this.db.close() }
}

export interface GoogleMetricPoint {
  externalId: string
  date: string
  measuredAt: string
  weightKg?: number
  bodyFatPercent?: number
  bmi?: number
  leanBodyMassKg?: number
  raw: unknown
}

function rowToBodyMetric(row: Row): BodyMetric {
  return {
    id: String(row.id), date: String(row.date),
    ...(row.weight_kg == null ? {} : { weightKg: Number(row.weight_kg) }),
    ...(row.muscle_mass_kg == null ? {} : { muscleMassKg: Number(row.muscle_mass_kg) }),
    ...(row.body_fat_percent == null ? {} : { bodyFatPercent: Number(row.body_fat_percent) }),
    ...(row.bmi == null ? {} : { bmi: Number(row.bmi) }),
    ...(row.lean_body_mass_kg == null ? {} : { leanBodyMassKg: Number(row.lean_body_mass_kg) }),
    source: String(row.source) as BodyMetric['source'],
    ...(row.measured_at == null ? {} : { measuredAt: String(row.measured_at) }),
    ...(row.external_id == null ? {} : { externalId: String(row.external_id) }),
    createdAt: String(row.created_at),
  }
}

function rowToGymTemplate(db: Database.Database, row: Row, profileId: string): GymTemplate {
  const exercises = db.prepare('SELECT * FROM gym_template_exercises WHERE profile_id=? AND template_id=? ORDER BY position').all(profileId, row.id) as Row[]
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: normalizeSqlTimestamp(String(row.created_at)),
    updatedAt: normalizeSqlTimestamp(String(row.updated_at)),
    exercises: exercises.map((exercise) => ({
      id: String(exercise.id),
      name: String(exercise.name),
      sets: Number(exercise.sets),
      ...(exercise.target_weight_kg == null ? {} : { targetWeightKg: Number(exercise.target_weight_kg) }),
      targetReps: Number(exercise.target_reps),
      position: Number(exercise.position),
    })),
  }
}

function rowToGymSession(db: Database.Database, row: Row, profileId: string): GymSession {
  const exercises = db.prepare('SELECT * FROM gym_session_exercises WHERE profile_id=? AND session_id=? ORDER BY position').all(profileId, row.id) as Row[]
  return {
    id: String(row.id),
    ...(row.template_id == null ? {} : { templateId: String(row.template_id) }),
    templateName: String(row.template_name),
    date: String(row.date),
    startedAt: normalizeSqlTimestamp(String(row.started_at)),
    completedAt: normalizeSqlTimestamp(String(row.completed_at)),
    exercises: exercises.map((exercise) => ({
      id: String(exercise.id),
      ...(exercise.template_exercise_id == null ? {} : { templateExerciseId: String(exercise.template_exercise_id) }),
      name: String(exercise.name),
      sets: Number(exercise.sets),
      ...(exercise.weight_kg == null ? {} : { weightKg: Number(exercise.weight_kg) }),
      reps: Number(exercise.reps),
      position: Number(exercise.position),
      performedSets: (db.prepare('SELECT * FROM gym_session_sets WHERE profile_id=? AND session_exercise_id=? ORDER BY set_number').all(profileId, exercise.id) as Row[]).map((set) => ({
        id: String(set.id), setNumber: Number(set.set_number),
        ...(set.weight_kg == null ? {} : { weightKg: Number(set.weight_kg) }), reps: Number(set.reps),
      })),
    })),
  }
}

function normalizeSqlTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
}

function integrityError() {
  const error = new Error('Mutation verletzt die Datenintegrität.')
  Object.assign(error, { code: 'DATA_INTEGRITY' })
  return error
}

export const EXPECTED_SCHEMA_VERSION = 6
