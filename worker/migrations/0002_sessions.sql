PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  protocol TEXT NOT NULL UNIQUE,
  session_token_hash TEXT NOT NULL,
  department TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  consent_text_version TEXT NOT NULL,
  bitrix_entity_id TEXT,
  bitrix_notified INTEGER NOT NULL DEFAULT 0 CHECK (bitrix_notified IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_protocol ON chat_sessions(protocol);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_token ON chat_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_expires ON chat_sessions(expires_at);
