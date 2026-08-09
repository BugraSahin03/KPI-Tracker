CREATE TABLE IF NOT EXISTS mutation_receipts (
  mutation_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE app_state ADD COLUMN seed_pristine INTEGER NOT NULL DEFAULT 1;
