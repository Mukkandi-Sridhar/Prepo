-- Prepo initial schema.
-- Requires the pgvector extension; the pgvector/pgvector:pg16 image has it.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* ── identity ───────────────────────────────────────────────── */

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  name        text,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  access_token        jsonb,
  scope               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_account_id)
);
CREATE INDEX accounts_user_idx ON accounts (user_id);

CREATE TABLE verification_tokens (
  token       text PRIMARY KEY,
  identifier  text NOT NULL,
  payload     jsonb,
  expires_at  timestamptz NOT NULL
);

CREATE TABLE orgs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id   uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     text NOT NULL DEFAULT 'member',
  PRIMARY KEY (org_id, user_id)
);

/* ── credentials ────────────────────────────────────────────── */

CREATE TABLE provider_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     text NOT NULL,
  ciphertext   text,
  iv           text,
  auth_tag     text,
  last4        text NOT NULL,
  mode         text NOT NULL DEFAULT 'stored',
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX provider_keys_user_provider_idx ON provider_keys (user_id, provider);

/* ── source ─────────────────────────────────────────────────── */

CREATE TABLE projects (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  source_type          text NOT NULL,
  source_url           text,
  visibility           text NOT NULL DEFAULT 'public',
  current_snapshot_id  uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner_idx ON projects (owner_id);

CREATE TABLE repo_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha        text NOT NULL,
  size_bytes        integer NOT NULL DEFAULT 0,
  file_count        integer NOT NULL DEFAULT 0,
  repo_facts        jsonb,
  redaction_report  jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX repo_snapshots_project_sha_idx ON repo_snapshots (project_id, commit_sha);

CREATE TABLE source_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  path            text NOT NULL,
  lang            text NOT NULL,
  loc             integer NOT NULL DEFAULT 0,
  content_sha256  text NOT NULL
);
CREATE INDEX source_files_snapshot_idx ON source_files (snapshot_id);
CREATE INDEX source_files_hash_idx ON source_files (content_sha256);

-- Global, not per-user: forks and re-runs share one cached summary.
CREATE TABLE file_summaries (
  content_sha256  text PRIMARY KEY,
  summary         text NOT NULL,
  model           text NOT NULL,
  tokens          integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id  uuid NOT NULL REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  path         text NOT NULL,
  symbol       text,
  start_line   integer NOT NULL,
  end_line     integer NOT NULL,
  content      text NOT NULL,
  embedding    vector(1536)
);
CREATE INDEX chunks_snapshot_idx ON chunks (snapshot_id);

-- HNSW over cosine distance. m/ef_construction are the pgvector defaults;
-- raise ef_construction if recall matters more than index build time.
CREATE INDEX chunks_embedding_idx ON chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

/* ── derived ────────────────────────────────────────────────── */

CREATE TABLE dossiers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id  uuid NOT NULL UNIQUE REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  content      jsonb NOT NULL,
  model        text NOT NULL,
  cost_cents   real NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_id   uuid REFERENCES repo_snapshots(id) ON DELETE SET NULL,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'analyze',
  state         text NOT NULL DEFAULT 'queued',
  stage         text,
  progress      real NOT NULL DEFAULT 0,
  error         text,
  budget_cents  integer NOT NULL DEFAULT 200,
  spent_cents   real NOT NULL DEFAULT 0,
  options       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX jobs_project_idx ON jobs (project_id);

CREATE TABLE job_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage        text NOT NULL,
  state        text NOT NULL DEFAULT 'pending',
  input_hash   text,
  output_ref   text,
  error        text,
  started_at   timestamptz,
  finished_at  timestamptz
);
CREATE UNIQUE INDEX job_steps_job_stage_idx ON job_steps (job_id, stage);

/* ── product ────────────────────────────────────────────────── */

CREATE TABLE question_sets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  resume_id       uuid,
  role_id         uuid,
  question_count  integer NOT NULL DEFAULT 0,
  dropped_count   integer NOT NULL DEFAULT 0,
  cost_cents      real NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id        uuid NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  category      text NOT NULL,
  difficulty    text NOT NULL,
  persona       text NOT NULL,
  stem          text NOT NULL,
  model_answer  text NOT NULL,
  probes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  testing_for   text NOT NULL,
  red_flags     jsonb NOT NULL DEFAULT '[]'::jsonb,
  star_frame    jsonb,
  groundedness  numeric(3,2) NOT NULL DEFAULT 0,
  rank          real NOT NULL DEFAULT 0
);
CREATE INDEX questions_set_idx ON questions (set_id);

CREATE TABLE citations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  path         text NOT NULL,
  start_line   integer NOT NULL,
  end_line     integer NOT NULL,
  symbol       text,
  commit_sha   text NOT NULL
);
CREATE INDEX citations_question_idx ON citations (question_id);

CREATE TABLE resumes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename      text,
  text          text NOT NULL,
  claims        jsonb,
  claim_checks  jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE target_roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          text NOT NULL,
  company        text,
  jd_text        text,
  stack_weights  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

/* ── practice ───────────────────────────────────────────────── */

CREATE TABLE practice_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id       uuid NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  mode         text NOT NULL DEFAULT 'standard',
  plan         jsonb,
  state        text NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX practice_sessions_user_idx ON practice_sessions (user_id);

CREATE TABLE turns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  idx         integer NOT NULL,
  role        text NOT NULL,
  content     text NOT NULL,
  move        text,
  beat_index  integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX turns_session_idx_idx ON turns (session_id, idx);

CREATE TABLE evaluations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL UNIQUE REFERENCES practice_sessions(id) ON DELETE CASCADE,
  result      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE srs_cards (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id       uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  due_at            timestamptz NOT NULL DEFAULT now(),
  stability         real NOT NULL DEFAULT 1,
  difficulty        real NOT NULL DEFAULT 5,
  reps              integer NOT NULL DEFAULT 0,
  lapses            integer NOT NULL DEFAULT 0,
  last_reviewed_at  timestamptz
);
CREATE UNIQUE INDEX srs_cards_user_question_idx ON srs_cards (user_id, question_id);
CREATE INDEX srs_cards_due_idx ON srs_cards (user_id, due_at);

CREATE TABLE reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id      uuid NOT NULL REFERENCES srs_cards(id) ON DELETE CASCADE,
  rating       integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

/* ── ops ────────────────────────────────────────────────────── */

CREATE TABLE usage_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  job_id         uuid REFERENCES jobs(id) ON DELETE CASCADE,
  stage          text,
  provider       text NOT NULL,
  model          text NOT NULL,
  input_tokens   integer NOT NULL DEFAULT 0,
  output_tokens  integer NOT NULL DEFAULT 0,
  cached_tokens  integer NOT NULL DEFAULT 0,
  cost_cents     real NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_job_idx ON usage_events (job_id);

CREATE TABLE audit_log (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  action    text NOT NULL,
  target    text,
  metadata  jsonb,
  ip        text,
  at        timestamptz NOT NULL DEFAULT now()
);
