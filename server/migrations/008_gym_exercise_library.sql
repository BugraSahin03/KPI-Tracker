CREATE TABLE gym_exercises (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  legacy_template_exercise_id TEXT,
  UNIQUE (profile_id, id),
  UNIQUE (profile_id, legacy_template_exercise_id)
);

-- Deliberately create one canonical row per template exercise. Equal names are
-- never merged automatically.
INSERT INTO gym_exercises(id,profile_id,name,created_at,updated_at,legacy_template_exercise_id)
SELECT 'gym-exercise-v8-t-' || exercise.rowid,
       exercise.profile_id,
       exercise.name,
       template.created_at,
       template.updated_at,
       exercise.id
FROM gym_template_exercises AS exercise
JOIN gym_templates AS template
  ON template.profile_id=exercise.profile_id AND template.id=exercise.template_id;

ALTER TABLE gym_template_exercises
  ADD COLUMN exercise_id TEXT REFERENCES gym_exercises(id) ON DELETE RESTRICT;

UPDATE gym_template_exercises
SET exercise_id=(
  SELECT canonical.id FROM gym_exercises AS canonical
  WHERE canonical.profile_id=gym_template_exercises.profile_id
    AND canonical.legacy_template_exercise_id=gym_template_exercises.id
);

-- Preserve snapshots from already deleted templates by creating a canonical
-- row for every still-known stable templateExerciseId.
INSERT OR IGNORE INTO gym_exercises(id,profile_id,name,created_at,updated_at,legacy_template_exercise_id)
SELECT 'gym-exercise-v8-s-' || MIN(exercise.rowid),
       exercise.profile_id,
       (SELECT newest.name
        FROM gym_session_exercises AS newest
        JOIN gym_sessions AS newest_session
          ON newest_session.profile_id=newest.profile_id AND newest_session.id=newest.session_id
        WHERE newest.profile_id=exercise.profile_id
          AND newest.template_exercise_id=exercise.template_exercise_id
        ORDER BY julianday(newest_session.completed_at) DESC,
                 newest_session.completed_at DESC,
                 newest_session.id DESC,
                 newest.id DESC
        LIMIT 1),
       MIN(session.started_at),
       MAX(session.completed_at),
       exercise.template_exercise_id
FROM gym_session_exercises AS exercise
JOIN gym_sessions AS session
  ON session.profile_id=exercise.profile_id AND session.id=exercise.session_id
WHERE exercise.template_exercise_id IS NOT NULL
GROUP BY exercise.profile_id, exercise.template_exercise_id;

-- Truly unlinked legacy snapshots remain individually addressable.
INSERT INTO gym_exercises(id,profile_id,name,created_at,updated_at,legacy_template_exercise_id)
SELECT 'gym-exercise-v8-u-' || exercise.rowid,
       exercise.profile_id,
       exercise.name,
       session.started_at,
       session.completed_at,
       NULL
FROM gym_session_exercises AS exercise
JOIN gym_sessions AS session
  ON session.profile_id=exercise.profile_id AND session.id=exercise.session_id
WHERE exercise.template_exercise_id IS NULL;

ALTER TABLE gym_session_exercises
  ADD COLUMN exercise_id TEXT REFERENCES gym_exercises(id) ON DELETE RESTRICT;

UPDATE gym_session_exercises
SET exercise_id=COALESCE(
  (SELECT canonical.id FROM gym_exercises AS canonical
   WHERE canonical.profile_id=gym_session_exercises.profile_id
     AND canonical.legacy_template_exercise_id=gym_session_exercises.template_exercise_id),
  'gym-exercise-v8-u-' || gym_session_exercises.rowid
);

CREATE INDEX gym_exercises_profile_name_idx ON gym_exercises(profile_id,name COLLATE NOCASE);
CREATE INDEX gym_template_exercises_canonical_idx ON gym_template_exercises(profile_id,exercise_id);
CREATE INDEX gym_session_exercises_canonical_idx ON gym_session_exercises(profile_id,exercise_id);
