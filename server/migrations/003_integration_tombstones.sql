CREATE TABLE IF NOT EXISTS integration_ignored_points (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  ignored_at TEXT NOT NULL,
  PRIMARY KEY (provider, external_id)
);
