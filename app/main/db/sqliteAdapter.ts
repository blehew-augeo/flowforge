// SQLite adapter implementing database ports using better-sqlite3

import Database from 'better-sqlite3'
import * as fs from 'fs'
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

let db: Database.Database | null = null

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
export function initDb(): void {
  if (db) {
    log.warn('[DB] Database already initialized')
    return
  }

  const dbPath = getDbPath()
  log.info('[DB] Initializing database at:', dbPath)

  // Create database connection
  db = new Database(dbPath, {
    verbose: (message) => {
      if (process.env['NODE_ENV'] === 'development') {
        log.debug('[DB]', message)
      }
    }
  })

  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  // Run schema migrations
  runMigrations(db)

  log.info('[DB] Database initialized successfully')
}

/**
 * Run database schema migrations
 */
function runMigrations(database: Database.Database): void {
  log.info('[DB] Running schema migrations...')

  // Read schema.sql from the same directory
  const schemaPath = path.join(__dirname, 'schema.sql')
  
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found at: ${schemaPath}`)
  }

  const schema = fs.readFileSync(schemaPath, 'utf-8')

  // Execute schema (better-sqlite3 can handle multiple statements)
  database.exec(schema)

  log.info('[DB] Schema migrations completed')
}

/**
 * Close the database connection
 */
export function closeDb(): void {
  if (db) {
    log.info('[DB] Closing database connection')
    db.close()
    db = null
  }
}

/**
 * Get the database instance (throws if not initialized)
 */
function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return db
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
    const result = database
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 as next_seq FROM events WHERE aggregate_type = ? AND aggregate_id = ?')
      .get(aggregateType, event.aggregateId) as { next_seq: number }

    const seq = result.next_seq
    const id = generateId()
    const txId = generateId() // Simple transaction ID (could be enhanced)
    const timestamp = new Date().toISOString()

    // Insert event with new schema
    database
      .prepare(`
        INSERT INTO events (
          id, aggregate_type, aggregate_id, event_type, event_version, 
          seq, tx_id, caused_by_event_id, payload_json, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
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

    const rows = database.prepare(sql).all(...params) as Array<{
      aggregate_id: string
      seq: number
      event_type: string
      payload_json: string
      metadata_json: string | null
      created_at: string
    }>

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

    const row = database
      .prepare('SELECT * FROM snapshots WHERE aggregate_type = ? AND aggregate_id = ?')
      .get(aggregateType, args.aggregateId) as {
        aggregate_id: string
        last_seq: number
        state_json: string
        created_at: string
      } | undefined

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

    // Use INSERT OR REPLACE since the unique index is on (aggregate_type, aggregate_id)
    // First try to update existing, if not exists then insert
    const existing = database
      .prepare('SELECT id FROM snapshots WHERE aggregate_type = ? AND aggregate_id = ?')
      .get(aggregateType, snapshot.aggregateId) as { id: string } | undefined

    if (existing) {
      database
        .prepare(`
          UPDATE snapshots 
          SET last_seq = ?, state_json = ?, created_at = ?
          WHERE aggregate_type = ? AND aggregate_id = ?
        `)
        .run(
          snapshot.lastSeq,
          JSON.stringify(snapshot.state),
          timestamp,
          aggregateType,
          snapshot.aggregateId
        )
    } else {
      database
        .prepare(`
          INSERT INTO snapshots (id, aggregate_type, aggregate_id, last_seq, state_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          aggregateType,
          snapshot.aggregateId,
          snapshot.lastSeq,
          JSON.stringify(snapshot.state),
          timestamp
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
      const stmt = database.prepare(args.sql)
      const rows = args.params ? stmt.all(...args.params) : stmt.all()
      return rows as Array<Record<string, unknown>>
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

    const stmt = database.prepare(sql)

    // Use transaction for bulk insert
    const insert = database.transaction((rows: Array<Record<string, unknown>>) => {
      for (const row of rows) {
        const values = columns.map(col => {
          const value = row[col]
          // Convert objects/arrays to JSON strings
          if (value !== null && typeof value === 'object') {
            return JSON.stringify(value)
          }
          return value
        })
        stmt.run(...values)
      }
    })

    insert(args.rows)
  }

  async truncate(args: { table: string }): Promise<void> {
    const database = getDb()

    // Validate table name to prevent SQL injection
    // Only allow alphanumeric and underscore
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(args.table)) {
      throw new Error(`Invalid table name: ${args.table}`)
    }

    database.prepare(`DELETE FROM ${args.table}`).run()
  }
}

// ============================================================================
// TRANSACTION ADAPTER
// ============================================================================

export class SqliteTx implements TxPort {
  async runInTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const database = getDb()

    // better-sqlite3 transaction
    const transaction = database.transaction(() => {
      return fn()
    })

    return transaction() as T
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

    database
      .prepare(`
        INSERT OR REPLACE INTO blobs (key, data, content_type, size, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        args.key,
        args.data,
        args.contentType || null,
        args.data.length,
        timestamp
      )
  }

  async get(args: {
    key: string
  }): Promise<{ data: Buffer; contentType?: string } | null> {
    const database = getDb()

    const row = database
      .prepare('SELECT data, content_type FROM blobs WHERE key = ?')
      .get(args.key) as {
        data: Buffer
        content_type: string | null
      } | undefined

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

    const row = database
      .prepare('SELECT size, content_type FROM blobs WHERE key = ?')
      .get(args.key) as {
        size: number
        content_type: string | null
      } | undefined

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

