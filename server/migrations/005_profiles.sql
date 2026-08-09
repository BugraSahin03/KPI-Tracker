CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  initial TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL UNIQUE
);

INSERT INTO profiles(id, name, initial, color, position) VALUES
  ('profile-bugra', 'Bugra', 'B', '#c6ff3d', 0),
  ('profile-sena', 'Sena', 'S', '#a78bfa', 1);

CREATE TABLE goals_v5 (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL, unit TEXT NOT NULL, target REAL NOT NULL CHECK (target > 0),
  icon TEXT NOT NULL, color TEXT NOT NULL, active INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL, activity_periods_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, id)
);
INSERT INTO goals_v5 SELECT 'profile-bugra', id,name,unit,target,icon,color,active,created_at,activity_periods_json FROM goals;

CREATE TABLE daily_entries_v5 (
  profile_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  date TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('done', 'failed')), updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, goal_id, date),
  FOREIGN KEY (profile_id, goal_id) REFERENCES goals_v5(profile_id, id) ON DELETE CASCADE
);
INSERT INTO daily_entries_v5 SELECT 'profile-bugra',goal_id,date,status,updated_at FROM daily_entries;

CREATE TABLE body_metrics_v5 (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  id TEXT NOT NULL, date TEXT NOT NULL, weight_kg REAL, muscle_mass_kg REAL, body_fat_percent REAL,
  bmi REAL, lean_body_mass_kg REAL, source TEXT NOT NULL DEFAULT 'manual', measured_at TEXT,
  external_id TEXT, created_at TEXT NOT NULL, raw_json TEXT,
  PRIMARY KEY (profile_id, id), UNIQUE(profile_id, external_id)
);
INSERT INTO body_metrics_v5 SELECT 'profile-bugra',id,date,weight_kg,muscle_mass_kg,body_fat_percent,bmi,lean_body_mass_kg,source,measured_at,external_id,created_at,raw_json FROM body_metrics;

CREATE TABLE gym_templates_v5 (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  id TEXT NOT NULL, name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 50),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(profile_id, id)
);
INSERT INTO gym_templates_v5 SELECT 'profile-bugra',id,name,created_at,updated_at FROM gym_templates;

CREATE TABLE gym_template_exercises_v5 (
  profile_id TEXT NOT NULL, id TEXT NOT NULL, template_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80), sets INTEGER NOT NULL CHECK (sets BETWEEN 1 AND 20),
  target_weight_kg REAL CHECK (target_weight_kg BETWEEN 0 AND 1000), target_reps INTEGER NOT NULL CHECK (target_reps BETWEEN 1 AND 100),
  position INTEGER NOT NULL CHECK (position >= 0), PRIMARY KEY(profile_id,id),
  FOREIGN KEY(profile_id,template_id) REFERENCES gym_templates_v5(profile_id,id) ON DELETE CASCADE,
  UNIQUE(profile_id,template_id,position), UNIQUE(profile_id,template_id,name COLLATE NOCASE)
);
INSERT INTO gym_template_exercises_v5 SELECT 'profile-bugra',id,template_id,name,sets,target_weight_kg,target_reps,position FROM gym_template_exercises;

CREATE TABLE gym_sessions_v5 (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  id TEXT NOT NULL, template_id TEXT, template_name TEXT NOT NULL CHECK (length(trim(template_name)) BETWEEN 1 AND 50),
  date TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
  PRIMARY KEY(profile_id,id)
);
INSERT INTO gym_sessions_v5 SELECT 'profile-bugra',id,template_id,template_name,date,started_at,completed_at FROM gym_sessions;

CREATE TABLE gym_session_exercises_v5 (
  profile_id TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT NOT NULL, template_exercise_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80), sets INTEGER NOT NULL CHECK (sets BETWEEN 1 AND 20),
  weight_kg REAL CHECK (weight_kg BETWEEN 0 AND 1000), reps INTEGER NOT NULL CHECK (reps BETWEEN 1 AND 100),
  position INTEGER NOT NULL CHECK (position >= 0), PRIMARY KEY(profile_id,id),
  FOREIGN KEY(profile_id,session_id) REFERENCES gym_sessions_v5(profile_id,id) ON DELETE CASCADE,
  UNIQUE(profile_id,session_id,position), UNIQUE(profile_id,session_id,name COLLATE NOCASE)
);
INSERT INTO gym_session_exercises_v5 SELECT 'profile-bugra',id,session_id,template_exercise_id,name,sets,weight_kg,reps,position FROM gym_session_exercises;

CREATE TABLE integration_data_points_v5 (
  provider TEXT NOT NULL, external_id TEXT NOT NULL, profile_id TEXT NOT NULL DEFAULT 'profile-bugra', body_metric_id TEXT NOT NULL,
  imported_at TEXT NOT NULL, PRIMARY KEY(provider,external_id),
  FOREIGN KEY(profile_id,body_metric_id) REFERENCES body_metrics_v5(profile_id,id) ON DELETE CASCADE
);
INSERT INTO integration_data_points_v5(provider,external_id,profile_id,body_metric_id,imported_at)
SELECT provider,external_id,'profile-bugra',body_metric_id,imported_at FROM integration_data_points;

DROP TABLE integration_data_points;
DROP TABLE gym_session_exercises;
DROP TABLE gym_sessions;
DROP TABLE gym_template_exercises;
DROP TABLE gym_templates;
DROP TABLE daily_entries;
DROP TABLE goals;
DROP TABLE body_metrics;

ALTER TABLE goals_v5 RENAME TO goals;
ALTER TABLE daily_entries_v5 RENAME TO daily_entries;
ALTER TABLE body_metrics_v5 RENAME TO body_metrics;
ALTER TABLE gym_templates_v5 RENAME TO gym_templates;
ALTER TABLE gym_template_exercises_v5 RENAME TO gym_template_exercises;
ALTER TABLE gym_sessions_v5 RENAME TO gym_sessions;
ALTER TABLE gym_session_exercises_v5 RENAME TO gym_session_exercises;
ALTER TABLE integration_data_points_v5 RENAME TO integration_data_points;

CREATE INDEX goals_profile_idx ON goals(profile_id);
CREATE INDEX daily_entries_profile_date_idx ON daily_entries(profile_id,date);
CREATE INDEX body_metrics_profile_measured_at_idx ON body_metrics(profile_id,measured_at DESC);
CREATE INDEX gym_templates_profile_idx ON gym_templates(profile_id);
CREATE INDEX gym_sessions_profile_date_idx ON gym_sessions(profile_id,date DESC,completed_at DESC);

CREATE TABLE mutation_receipts_v5 (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY(profile_id, mutation_id)
);
INSERT INTO mutation_receipts_v5(profile_id,mutation_id,kind,applied_at)
SELECT 'profile-bugra',mutation_id,kind,applied_at FROM mutation_receipts;
DROP TABLE mutation_receipts;
ALTER TABLE mutation_receipts_v5 RENAME TO mutation_receipts;
