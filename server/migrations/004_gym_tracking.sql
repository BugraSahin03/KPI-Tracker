CREATE TABLE IF NOT EXISTS gym_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 50),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gym_template_exercises (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES gym_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  sets INTEGER NOT NULL CHECK (sets BETWEEN 1 AND 20),
  target_weight_kg REAL CHECK (target_weight_kg BETWEEN 0 AND 1000),
  target_reps INTEGER NOT NULL CHECK (target_reps BETWEEN 1 AND 100),
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (template_id, position),
  UNIQUE (template_id, name COLLATE NOCASE)
);

CREATE TABLE IF NOT EXISTS gym_sessions (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES gym_templates(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL CHECK (length(trim(template_name)) BETWEEN 1 AND 50),
  date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gym_session_exercises (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES gym_sessions(id) ON DELETE CASCADE,
  template_exercise_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  sets INTEGER NOT NULL CHECK (sets BETWEEN 1 AND 20),
  weight_kg REAL CHECK (weight_kg BETWEEN 0 AND 1000),
  reps INTEGER NOT NULL CHECK (reps BETWEEN 1 AND 100),
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (session_id, position),
  UNIQUE (session_id, name COLLATE NOCASE)
);

CREATE INDEX IF NOT EXISTS gym_sessions_date_idx ON gym_sessions(date DESC, completed_at DESC);

-- Die drei Splits werden genau einmal als bewusst leere Vorlagen angelegt.
-- Der Nutzer trägt sein persönliches Programm ein; Pace erfindet keine Gewichte.
INSERT OR IGNORE INTO gym_templates(id, name, created_at, updated_at)
VALUES
  ('gym-template-push', 'Push', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gym-template-pull', 'Pull', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gym-template-beine', 'Beine', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
