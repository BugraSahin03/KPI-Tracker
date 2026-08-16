CREATE TABLE gym_session_sets (
  profile_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_exercise_id TEXT NOT NULL,
  set_number INTEGER NOT NULL CHECK (set_number BETWEEN 1 AND 20),
  weight_kg REAL CHECK (weight_kg BETWEEN 0 AND 1000),
  reps INTEGER NOT NULL CHECK (reps BETWEEN 1 AND 100),
  PRIMARY KEY (profile_id, id),
  FOREIGN KEY (profile_id, session_exercise_id)
    REFERENCES gym_session_exercises(profile_id, id) ON DELETE CASCADE,
  UNIQUE (profile_id, session_exercise_id, set_number)
);

-- Schema 5 only knew one aggregate value per exercise. Replicating that exact
-- value for every recorded set preserves all information while enabling sets.
WITH RECURSIVE set_numbers(number) AS (
  SELECT 1
  UNION ALL
  SELECT number + 1 FROM set_numbers WHERE number < 20
)
INSERT INTO gym_session_sets(profile_id,id,session_exercise_id,set_number,weight_kg,reps)
SELECT exercise.profile_id,
       'legacy-set-row-' || exercise.rowid || '-' || set_numbers.number,
       exercise.id,
       set_numbers.number,
       exercise.weight_kg,
       exercise.reps
FROM gym_session_exercises AS exercise
JOIN set_numbers ON set_numbers.number <= exercise.sets;

CREATE INDEX gym_session_sets_exercise_idx
  ON gym_session_sets(profile_id, session_exercise_id, set_number);
