CREATE TABLE weekly_goals (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 50),
  target_count INTEGER NOT NULL CHECK (target_count BETWEEN 1 AND 7),
  source_type TEXT NOT NULL CHECK (source_type IN ('gym', 'run', 'manual')),
  gym_template_ids_json TEXT,
  run_environment TEXT CHECK (run_environment IN ('any', 'indoor', 'outdoor')),
  color TEXT NOT NULL,
  icon TEXT NOT NULL CHECK (icon IN ('gym', 'run', 'calendar', 'custom')),
  created_at TEXT NOT NULL,
  start_date TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  counting_mode TEXT NOT NULL CHECK (counting_mode = 'unique-days'),
  definitions_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, id)
);

CREATE TABLE weekly_goal_adjustments (
  profile_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  date TEXT NOT NULL,
  -- `open` is retained as a timestamped tombstone so a delayed offline
  -- mutation cannot resurrect an older manual override.
  status TEXT NOT NULL CHECK (status IN ('open', 'done', 'sick', 'injured')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, goal_id, date),
  FOREIGN KEY (profile_id, goal_id) REFERENCES weekly_goals(profile_id, id) ON DELETE CASCADE
);

CREATE INDEX weekly_goals_profile_active_idx ON weekly_goals(profile_id, active);
CREATE INDEX weekly_goal_adjustments_profile_date_idx ON weekly_goal_adjustments(profile_id, date);
