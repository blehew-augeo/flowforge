// SQLite adapter implementing database ports using sqlite3

import sqlite3 from 'sqlite3'
import * as path from 'path'
import { app } from 'electron'
import log from 'electron-log'
import type {
  EventStorePort,
  ProjectionStorePort,
  TxPort,
  BlobStorePort,
  Event,
  Snapshot
} from './ports'

let db: sqlite3.Database | null = null

/**
 * Get database path in user data directory
 */
function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'flowforge.db')
}

/**
 * Initialize the database connection and run migrations
 */
export async function initDb(): Promise<void> {
  if (db) {
    log.warn('[DB] Database already initialized')
    return
  }

  const dbPath = getDbPath()
  log.info('[DB] Initializing database at:', dbPath)

  // Create database connection
  db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve(database)
      }
    })
  })

  // Enable foreign keys
  await runAsync(db, 'PRAGMA foreign_keys = ON')

  // Run schema migrations
  await runMigrations(db)

  log.info('[DB] Database initialized successfully')
}

/**
 * Database schema
 * Embedded directly to avoid build/packaging issues
 */
const SCHEMA = `
-- 1) Event Store (source of truth)
CREATE TABLE IF NOT EXISTS events (
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_agg_seq ON events(aggregate_type, aggregate_id, seq);
CREATE INDEX IF NOT EXISTS ix_events_tx ON events(tx_id);
CREATE INDEX IF NOT EXISTS ix_events_created ON events(created_at);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  last_seq INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_snapshots_agg ON snapshots(aggregate_type, aggregate_id);

-- 2) Catalog: data sources, schemas, connectors
CREATE TABLE IF NOT EXISTS schemas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  schema_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_schemas_name_ver ON schemas(name, version);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  config_json TEXT NOT NULL,
  schema_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_data_sources_kind ON data_sources(kind);

CREATE TABLE IF NOT EXISTS auth_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  config_json TEXT NOT NULL,
  secret_refs_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS endpoints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_profile_id TEXT,
  default_headers_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3) Workflow definitions (versioned DAG)
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflows_name ON workflows(name);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  activated_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wfv_workflow_ver ON workflow_versions(workflow_id, version);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  workflow_version_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  workflow_version_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  condition_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4) Reusable operators, rule sets, request templates
CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_operators_name ON operators(name);

CREATE TABLE IF NOT EXISTS rule_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  rules_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rule_sets_name_ver ON rule_sets(name, version);

CREATE TABLE IF NOT EXISTS request_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path_template TEXT NOT NULL,
  headers_template_json TEXT,
  body_template TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_request_templates_name ON request_templates(name);

-- 5) Execution: runs, steps, logs, artifacts, lineage
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workflow_version_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  input_manifest_json TEXT,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_runs_wfv ON runs(workflow_version_id);
CREATE INDEX IF NOT EXISTS ix_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS ix_runs_started ON runs(started_at);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  stats_json TEXT,
  started_at TIMESTAMP,
  finished_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_run_steps_run ON run_steps(run_id);

CREATE TABLE IF NOT EXISTS run_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  run_step_id TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  meta_json TEXT,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_run_logs_run ON run_logs(run_id);
CREATE INDEX IF NOT EXISTS ix_run_logs_level ON run_logs(level);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT,
  kind TEXT NOT NULL,
  uri TEXT,
  format TEXT,
  schema_json TEXT,
  rows INTEGER,
  stats_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_artifacts_run ON artifacts(run_id);

CREATE TABLE IF NOT EXISTS lineage (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  from_artifact_id TEXT NOT NULL,
  to_artifact_id TEXT NOT NULL,
  edge_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS request_executions (
  id TEXT PRIMARY KEY,
  run_step_id TEXT NOT NULL,
  template_id TEXT,
  request_json TEXT NOT NULL,
  response_json TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_req_exec_step ON request_executions(run_step_id);

-- 6) Materialized projections (optional, rebuilt from events)
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_uri TEXT,
  format TEXT,
  schema_id TEXT,
  stats_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS joins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  left_dataset_id TEXT NOT NULL,
  right_dataset_id TEXT NOT NULL,
  join_type TEXT NOT NULL,
  on_expr TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7) Scheduling
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  last_scheduled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8) Idempotency and dedupe
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9) Minimal ACL (optional)
CREATE TABLE IF NOT EXISTS principals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`

/**
 * Run database schema migrations
 */
async function runMigrations(database: sqlite3.Database): Promise<void> {
  log.info('[DB] Running schema migrations...')

  // Execute schema (split by semicolons and run each statement)
  const statements = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  for (const statement of statements) {
    await runAsync(database, statement)
  }

  log.info('[DB] Schema migrations completed')
}

/**
 * Close the database connection
 */
export function closeDb(): void {
  if (db) {
    log.info('[DB] Closing database connection')
    db.close((err) => {
      if (err) {
        log.error('[DB] Error closing database:', err)
      }
    })
    db = null
  }
}

/**
 * Get the database instance (throws if not initialized)
 */
function getDb(): sqlite3.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return db
}

/**
 * Promisify db.run
 */
function runAsync(database: sqlite3.Database, sql: string, params?: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    database.run(sql, params || [], (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

/**
 * Promisify db.get
 */
function getAsync<T>(database: sqlite3.Database, sql: string, params?: unknown[]): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    database.get(sql, params || [], (err, row) => {
      if (err) {
        reject(err)
      } else {
        resolve(row as T | undefined)
      }
    })
  })
}

/**
 * Promisify db.all
 */
function allAsync<T>(database: sqlite3.Database, sql: string, params?: unknown[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all(sql, params || [], (err, rows) => {
      if (err) {
        reject(err)
      } else {
        resolve(rows as T[])
      }
    })
  })
}

// ============================================================================
// EVENT STORE ADAPTER
// ============================================================================

/**
 * Generate a unique ID for database records
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export class SqliteEventStore implements EventStorePort {
  async append(event: {
    aggregateId: string
    eventType: string
    payload: Record<string, unknown>
    metadata?: Record<string, unknown>
  }): Promise<Event> {
    const database = getDb()

    // Determine aggregate type from aggregateId (format: type:id or just use 'default')
    const aggregateType = event.aggregateId.includes(':') 
      ? event.aggregateId.split(':')[0] 
      : 'default'

    // Get next sequence number for this aggregate
    const result = await getAsync<{ next_seq: number }>(
      database,
      'SELECT COALESCE(MAX(seq), 0) + 1 as next_seq FROM events WHERE aggregate_type = ? AND aggregate_id = ?',
      [aggregateType, event.aggregateId]
    )

    const seq = result?.next_seq || 1
    const id = generateId()
    const txId = generateId() // Simple transaction ID (could be enhanced)
    const timestamp = new Date().toISOString()

    // Insert event with new schema
    await runAsync(
      database,
      `INSERT INTO events (
        id, aggregate_type, aggregate_id, event_type, event_version, 
        seq, tx_id, caused_by_event_id, payload_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        aggregateType,
        event.aggregateId,
        event.eventType,
        1, // event_version - default to 1
        seq,
        txId,
        null, // caused_by_event_id - can be enhanced later
        JSON.stringify(event.payload),
        event.metadata ? JSON.stringify(event.metadata) : null,
        timestamp
      ]
    )

    return {
      aggregateId: event.aggregateId,
      seq,
      eventType: event.eventType,
      payload: event.payload,
      metadata: event.metadata,
      timestamp
    }
  }

  async load(args: { aggregateId: string; afterSeq?: number }): Promise<Event[]> {
    const database = getDb()

    // Determine aggregate type
    const aggregateType = args.aggregateId.includes(':') 
      ? args.aggregateId.split(':')[0] 
      : 'default'

    const sql = args.afterSeq !== undefined
      ? 'SELECT * FROM events WHERE aggregate_type = ? AND aggregate_id = ? AND seq > ? ORDER BY seq ASC'
      : 'SELECT * FROM events WHERE aggregate_type = ? AND aggregate_id = ? ORDER BY seq ASC'

    const params = args.afterSeq !== undefined 
      ? [aggregateType, args.aggregateId, args.afterSeq]
      : [aggregateType, args.aggregateId]

    const rows = await allAsync<{
      aggregate_id: string
      seq: number
      event_type: string
      payload_json: string
      metadata_json: string | null
      created_at: string
    }>(database, sql, params)

    return rows.map(row => ({
      aggregateId: row.aggregate_id,
      seq: row.seq,
      eventType: row.event_type,
      payload: JSON.parse(row.payload_json),
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      timestamp: row.created_at
    }))
  }

  async latestSnapshot(args: { aggregateId: string }): Promise<Snapshot | null> {
    const database = getDb()

    // Determine aggregate type
    const aggregateType = args.aggregateId.includes(':') 
      ? args.aggregateId.split(':')[0] 
      : 'default'

    const row = await getAsync<{
      aggregate_id: string
      last_seq: number
      state_json: string
      created_at: string
    }>(
      database,
      'SELECT * FROM snapshots WHERE aggregate_type = ? AND aggregate_id = ?',
      [aggregateType, args.aggregateId]
    )

    if (!row) {
      return null
    }

    return {
      aggregateId: row.aggregate_id,
      lastSeq: row.last_seq,
      state: JSON.parse(row.state_json),
      timestamp: row.created_at
    }
  }

  async saveSnapshot(snapshot: {
    aggregateId: string
    lastSeq: number
    state: Record<string, unknown>
  }): Promise<void> {
    const database = getDb()
    
    // Determine aggregate type
    const aggregateType = snapshot.aggregateId.includes(':') 
      ? snapshot.aggregateId.split(':')[0] 
      : 'default'
    
    const id = generateId()
    const timestamp = new Date().toISOString()

    // Check if snapshot exists
    const existing = await getAsync<{ id: string }>(
      database,
      'SELECT id FROM snapshots WHERE aggregate_type = ? AND aggregate_id = ?',
      [aggregateType, snapshot.aggregateId]
    )

    if (existing) {
      await runAsync(
        database,
        `UPDATE snapshots 
         SET last_seq = ?, state_json = ?, created_at = ?
         WHERE aggregate_type = ? AND aggregate_id = ?`,
        [
          snapshot.lastSeq,
          JSON.stringify(snapshot.state),
          timestamp,
          aggregateType,
          snapshot.aggregateId
        ]
      )
    } else {
      await runAsync(
        database,
        `INSERT INTO snapshots (id, aggregate_type, aggregate_id, last_seq, state_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          aggregateType,
          snapshot.aggregateId,
          snapshot.lastSeq,
          JSON.stringify(snapshot.state),
          timestamp
        ]
      )
    }
  }
}

// ============================================================================
// PROJECTION STORE ADAPTER
// ============================================================================

export class SqliteProjectionStore implements ProjectionStorePort {
  async query(args: {
    sql: string
    params?: unknown[]
  }): Promise<Array<Record<string, unknown>>> {
    const database = getDb()

    try {
      const rows = await allAsync<Record<string, unknown>>(database, args.sql, args.params)
      return rows
    } catch (error) {
      log.error('[DB] Query failed:', args.sql, error)
      throw error
    }
  }

  async upsert(args: {
    table: string
    rows: Array<Record<string, unknown>>
  }): Promise<void> {
    if (args.rows.length === 0) {
      return
    }

    const database = getDb()

    // Get column names from first row
    const columns = Object.keys(args.rows[0])
    const placeholders = columns.map(() => '?').join(', ')

    const sql = `
      INSERT OR REPLACE INTO ${args.table} (${columns.join(', ')})
      VALUES (${placeholders})
    `

    // Use serialize to ensure all inserts happen in sequence
    await new Promise<void>((resolve, reject) => {
      database.serialize(async () => {
        try {
          await runAsync(database, 'BEGIN TRANSACTION')
          
          for (const row of args.rows) {
            const values = columns.map(col => {
              const value = row[col]
              // Convert objects/arrays to JSON strings
              if (value !== null && typeof value === 'object') {
                return JSON.stringify(value)
              }
              return value
            })
            await runAsync(database, sql, values)
          }
          
          await runAsync(database, 'COMMIT')
          resolve()
        } catch (error) {
          await runAsync(database, 'ROLLBACK')
          reject(error)
        }
      })
    })
  }

  async truncate(args: { table: string }): Promise<void> {
    const database = getDb()

    // Validate table name to prevent SQL injection
    // Only allow alphanumeric and underscore
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(args.table)) {
      throw new Error(`Invalid table name: ${args.table}`)
    }

    await runAsync(database, `DELETE FROM ${args.table}`)
  }
}

// ============================================================================
// TRANSACTION ADAPTER
// ============================================================================

export class SqliteTx implements TxPort {
  async runInTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const database = getDb()

    // sqlite3 transaction using serialize
    return new Promise<T>((resolve, reject) => {
      database.serialize(async () => {
        try {
          await runAsync(database, 'BEGIN TRANSACTION')
          const result = await fn()
          await runAsync(database, 'COMMIT')
          resolve(result)
        } catch (error) {
          await runAsync(database, 'ROLLBACK')
          reject(error)
        }
      })
    })
  }
}

// ============================================================================
// BLOB STORE ADAPTER
// ============================================================================

export class SqliteBlobStore implements BlobStorePort {
  async put(args: {
    key: string
    data: Buffer
    contentType?: string
  }): Promise<void> {
    const database = getDb()
    const timestamp = new Date().toISOString()

    await runAsync(
      database,
      `INSERT OR REPLACE INTO blobs (key, data, content_type, size, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        args.key,
        args.data,
        args.contentType || null,
        args.data.length,
        timestamp
      ]
    )
  }

  async get(args: {
    key: string
  }): Promise<{ data: Buffer; contentType?: string } | null> {
    const database = getDb()

    const row = await getAsync<{
      data: Buffer
      content_type: string | null
    }>(
      database,
      'SELECT data, content_type FROM blobs WHERE key = ?',
      [args.key]
    )

    if (!row) {
      return null
    }

    return {
      data: row.data,
      contentType: row.content_type || undefined
    }
  }

  async stat(args: {
    key: string
  }): Promise<{ size: number; contentType?: string } | null> {
    const database = getDb()

    const row = await getAsync<{
      size: number
      content_type: string | null
    }>(
      database,
      'SELECT size, content_type FROM blobs WHERE key = ?',
      [args.key]
    )

    if (!row) {
      return null
    }

    return {
      size: row.size,
      contentType: row.content_type || undefined
    }
  }
}

// ============================================================================
// ADAPTER INSTANCES
// ============================================================================

export const eventStore = new SqliteEventStore()
export const projectionStore = new SqliteProjectionStore()
export const tx = new SqliteTx()
export const blobStore = new SqliteBlobStore()

