CREATE TABLE IF NOT EXISTS session_uploads (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  protocol TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_uploads_session ON session_uploads(session_id);
CREATE INDEX IF NOT EXISTS idx_session_uploads_expires ON session_uploads(expires_at);
