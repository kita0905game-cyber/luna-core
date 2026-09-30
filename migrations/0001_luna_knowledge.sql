-- LUNA Knowledge Base v1
-- Personal knowledge is never committed to the public repository.
-- This migration creates only schema and metadata tables.

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('constitution','second_brain','system_spec','bootstrap')),
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  source TEXT,
  source_ref TEXT,
  content_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kind_status
  ON knowledge_documents(kind, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_updated_at
  ON knowledge_documents(updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','activate','archive','import')),
  from_version INTEGER,
  to_version INTEGER NOT NULL,
  actor TEXT NOT NULL,
  summary TEXT,
  content_sha256 TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_changes_document
  ON knowledge_changes(document_id, id DESC);

CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  source_type TEXT NOT NULL CHECK (source_type IN ('user_statement','luna_analysis','journal','health','study','other')),
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'observing' CHECK (status IN ('observing','ask_user','promoted','discarded')),
  review_reason TEXT,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_status
  ON memory_candidates(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO knowledge_meta(key,value,updated_at)
VALUES ('schema_version','luna-knowledge/v1',datetime('now'));
