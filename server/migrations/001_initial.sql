CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  target REAL NOT NULL CHECK (target > 0),
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  activity_periods_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_entries (
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'failed')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (goal_id, date)
);

CREATE TABLE IF NOT EXISTS body_metrics (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  weight_kg REAL,
  muscle_mass_kg REAL,
  body_fat_percent REAL,
  bmi REAL,
  lean_body_mass_kg REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  measured_at TEXT,
  external_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS body_metrics_measured_at_idx ON body_metrics(measured_at DESC);

CREATE TABLE IF NOT EXISTS app_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  initialized_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  provider TEXT PRIMARY KEY,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TEXT,
  oauth_state TEXT,
  oauth_state_expires_at TEXT,
  sync_cursor TEXT,
  last_sync_at TEXT,
  last_sync_error TEXT,
  connected_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_data_points (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  body_metric_id TEXT NOT NULL REFERENCES body_metrics(id) ON DELETE CASCADE,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (provider, external_id)
);
