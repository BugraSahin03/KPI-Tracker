ALTER TABLE gym_template_exercises
  ADD COLUMN target_reps_max INTEGER
  CHECK (target_reps_max IS NULL OR (target_reps_max BETWEEN target_reps AND 100));

ALTER TABLE gym_session_exercises
  ADD COLUMN target_reps INTEGER
  CHECK (target_reps IS NULL OR target_reps BETWEEN 1 AND 100);

ALTER TABLE gym_session_exercises
  ADD COLUMN target_reps_max INTEGER
  CHECK (target_reps_max IS NULL OR (target_reps IS NOT NULL AND target_reps_max BETWEEN target_reps AND 100));

ALTER TABLE gym_session_exercises
  ADD COLUMN increase_next_time INTEGER NOT NULL DEFAULT 0
  CHECK (increase_next_time IN (0, 1));

ALTER TABLE gym_session_exercises
  ADD COLUMN completed INTEGER NOT NULL DEFAULT 0
  CHECK (completed IN (0, 1));
