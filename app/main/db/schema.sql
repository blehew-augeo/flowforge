-- 1) Event Store (source of truth)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  tx_id TEXT NOT NULL,
  caused_by_event_id TEXT,
  payload_json TEXT NOT NULL,
  metadata_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ux_events_agg_seq ON events(aggregate_type, aggregate_id, seq);
CREATE INDEX ix_events_tx ON events(tx_id);
CREATE INDEX ix_events_created ON events(created_at);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  last_seq INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ux_snapshots_agg ON snapshots(aggregate_type, aggregate_id);

-- 2) Catalog: data sources, schemas, connectors
CREATE TABLE schemas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  schema_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ux_schemas_name_ver ON schemas(name, version);

CREATE TABLE data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,          -- file|http|db|manual|excel|csv|parquet
  config_json TEXT NOT NULL,
  schema_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_data_sources_kind ON data_sources(kind);

CREATE TABLE auth_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,          -- ntlm|windows|basic|oauth2|api_key|none
  config_json TEXT NOT NULL,
  secret_refs_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE endpoints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_profile_id TEXT,
  default_headers_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3) Workflow definitions (versioned DAG)
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ux_workflows_name ON workflows(name);

CREATE TABLE workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,        -- draft|active|archived
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  activated_at TIMESTAMP
);
CREATE UNIQUE INDEX ux_wfv_workflow_ver ON workflow_versions(workflow_id, version);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  workflow_version_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- source|transform|join|rule|http|branch|sink
  name TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  workflow_version_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  condition_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4) Reusable operators, rule sets, request templates
CREATE TABLE operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,          -- transform|validation|aggregate|enricher
  spec_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ux_operators_name ON operators(name);

CREATE TABLE rule_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  rules_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ux_rule_sets_name_ver ON rule_sets(name, version);

CREATE TABLE request_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path_template TEXT NOT NULL,
  headers_template_json TEXT,
  body_template TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ux_request_templates_name ON request_templates(name);

-- 5) Execution: runs, steps, logs, artifacts, lineage
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  workflow_version_id TEXT NOT NULL,
  trigger TEXT NOT NULL,       -- manual|schedule|api|test
  status TEXT NOT NULL,        -- queued|running|succeeded|failed|canceled
  input_manifest_json TEXT,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_runs_wfv ON runs(workflow_version_id);
CREATE INDEX ix_runs_status ON runs(status);
CREATE INDEX ix_runs_started ON runs(started_at);

CREATE TABLE run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,        -- queued|running|succeeded|failed|skipped
  stats_json TEXT,
  started_at TIMESTAMP,
  finished_at TIMESTAMP
);
CREATE INDEX ix_run_steps_run ON run_steps(run_id);

CREATE TABLE run_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  run_step_id TEXT,
  level TEXT NOT NULL,         -- debug|info|warn|error
  message TEXT NOT NULL,
  meta_json TEXT,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_run_logs_run ON run_logs(run_id);
CREATE INDEX ix_run_logs_level ON run_logs(level);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT,
  kind TEXT NOT NULL,          -- table|file|view|http_response|metrics
  uri TEXT,
  format TEXT,                 -- parquet|csv|xlsx|duckdb|sqlite|json
  schema_json TEXT,
  rows INTEGER,
  stats_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_artifacts_run ON artifacts(run_id);

CREATE TABLE lineage (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  from_artifact_id TEXT NOT NULL,
  to_artifact_id TEXT NOT NULL,
  edge_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE request_executions (
  id TEXT PRIMARY KEY,
  run_step_id TEXT NOT NULL,
  template_id TEXT,
  request_json TEXT NOT NULL,
  response_json TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_req_exec_step ON request_executions(run_step_id);

-- 6) Materialized projections (optional, rebuilt from events)
CREATE TABLE datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_uri TEXT,
  format TEXT,
  schema_id TEXT,
  stats_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE joins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  left_dataset_id TEXT NOT NULL,
  right_dataset_id TEXT NOT NULL,
  join_type TEXT NOT NULL,     -- inner|left|right|full|semi|anti
  on_expr TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7) Scheduling
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL,    -- 0|1
  last_scheduled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8) Idempotency and dedupe
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9) Minimal ACL (optional)
CREATE TABLE principals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,          -- user|service
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,        -- read|write|execute|admin
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
