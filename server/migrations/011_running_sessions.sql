CREATE TABLE running_sessions (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('indoor', 'outdoor')),
  date TEXT NOT NULL,
  start_time TEXT,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 60 AND 86400),
  distance_km REAL NOT NULL CHECK (distance_km BETWEEN 0.05 AND 500),
  average_pace_seconds_per_km INTEGER NOT NULL CHECK (average_pace_seconds_per_km BETWEEN 60 AND 3600),
  average_heart_rate_bpm INTEGER CHECK (average_heart_rate_bpm BETWEEN 30 AND 250),
  effort INTEGER CHECK (effort BETWEEN 1 AND 10),
  active_calories INTEGER CHECK (active_calories BETWEEN 0 AND 10000),
  total_calories INTEGER CHECK (total_calories BETWEEN 0 AND 15000),
  elevation_gain_m REAL CHECK (elevation_gain_m BETWEEN 0 AND 20000),
  average_power_watts INTEGER CHECK (average_power_watts BETWEEN 0 AND 3000),
  average_cadence_spm INTEGER CHECK (average_cadence_spm BETWEEN 0 AND 300),
  source TEXT NOT NULL CHECK (source IN ('screenshot', 'manual', 'shortcut')),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, id),
  UNIQUE (profile_id, fingerprint)
);

CREATE INDEX running_sessions_profile_date_idx ON running_sessions(profile_id, date DESC, start_time DESC);
