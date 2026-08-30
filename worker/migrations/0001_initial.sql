PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT,
  department TEXT NOT NULL DEFAULT 'geral',
  content TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility = 'public'),
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  checksum TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_department_active ON knowledge_chunks(department, active);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  protocol TEXT NOT NULL UNIQUE,
  poll_token_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  department TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  consent_text_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  notification_channel TEXT,
  notification_state TEXT NOT NULL DEFAULT 'pending',
  whatsapp_message_id TEXT,
  bitrix_entity_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_handoffs_protocol ON handoffs(protocol);
CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_handoffs_expires ON handoffs(expires_at);
CREATE INDEX IF NOT EXISTS idx_handoffs_whatsapp_message ON handoffs(whatsapp_message_id);

CREATE TABLE IF NOT EXISTS handoff_events (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (handoff_id) REFERENCES handoffs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_handoff_events_handoff ON handoff_events(handoff_id, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (rate_key, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);
