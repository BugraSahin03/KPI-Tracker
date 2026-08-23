-- Persistent aliases make a merge durable across stale devices and offline
-- queues. IF NOT EXISTS also upgrades development databases that briefly had
-- this table while still reporting schema version 8.
CREATE TABLE IF NOT EXISTS gym_exercise_aliases (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, source_id),
  FOREIGN KEY (profile_id, target_id) REFERENCES gym_exercises(profile_id, id) ON DELETE RESTRICT,
  CHECK (source_id <> target_id)
);

CREATE INDEX IF NOT EXISTS gym_exercise_aliases_target_idx
  ON gym_exercise_aliases(profile_id,target_id);
