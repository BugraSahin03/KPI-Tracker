-- Zero is a meaningful performed value (for example, an attempted set that
-- could not be completed). Planned template targets continue to start at one.
CREATE TABLE gym_session_exercises_v10 (
  profile_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  template_exercise_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  sets INTEGER NOT NULL CHECK (sets BETWEEN 1 AND 20),
  weight_kg REAL CHECK (weight_kg BETWEEN 0 AND 1000),
  reps INTEGER NOT NULL CHECK (reps BETWEEN 0 AND 100),
  position INTEGER NOT NULL CHECK (position >= 0),
  target_reps INTEGER CHECK (target_reps IS NULL OR target_reps BETWEEN 1 AND 100),
  target_reps_max INTEGER CHECK (target_reps_max IS NULL OR (target_reps IS NOT NULL AND target_reps_max BETWEEN target_reps AND 100)),
  increase_next_time INTEGER NOT NULL DEFAULT 0 CHECK (increase_next_time IN (0, 1)),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  exercise_id TEXT REFERENCES gym_exercises(id) ON DELETE RESTRICT,
  PRIMARY KEY(profile_id,id),
  FOREIGN KEY(profile_id,session_id) REFERENCES gym_sessions(profile_id,id) ON DELETE CASCADE,
  UNIQUE(profile_id,session_id,position),
  UNIQUE(profile_id,session_id,name COLLATE NOCASE)
);

INSERT INTO gym_session_exercises_v10
SELECT profile_id,id,session_id,template_exercise_id,name,sets,weight_kg,reps,position,
       target_reps,target_reps_max,increase_next_time,completed,exercise_id
FROM gym_session_exercises;

CREATE TABLE gym_session_sets_v10 (
  profile_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_exercise_id TEXT NOT NULL,
  set_number INTEGER NOT NULL CHECK (set_number BETWEEN 1 AND 20),
  weight_kg REAL CHECK (weight_kg BETWEEN 0 AND 1000),
  reps INTEGER NOT NULL CHECK (reps BETWEEN 0 AND 100),
  PRIMARY KEY (profile_id, id),
  FOREIGN KEY (profile_id, session_exercise_id)
    REFERENCES gym_session_exercises_v10(profile_id, id) ON DELETE CASCADE,
  UNIQUE (profile_id, session_exercise_id, set_number)
);

INSERT INTO gym_session_sets_v10
SELECT profile_id,id,session_exercise_id,set_number,weight_kg,reps
FROM gym_session_sets;

DROP TABLE gym_session_sets;
DROP TABLE gym_session_exercises;
ALTER TABLE gym_session_exercises_v10 RENAME TO gym_session_exercises;
ALTER TABLE gym_session_sets_v10 RENAME TO gym_session_sets;

CREATE INDEX gym_session_exercises_canonical_idx
  ON gym_session_exercises(profile_id,exercise_id);
CREATE INDEX gym_session_sets_exercise_idx
  ON gym_session_sets(profile_id,session_exercise_id,set_number);
