// Database ports (interfaces) for hexagonal architecture
// The application depends on these interfaces, not concrete implementations

/**
 * Event for event sourcing
 */
export interface Event {
  aggregateId: string
  seq: number
  eventType: string
  payload: Record<string, unknown>
  timestamp: string // ISO 8601
  metadata?: Record<string, unknown>
}

/**
 * Snapshot for event sourcing
 */
export interface Snapshot {
  aggregateId: string
  lastSeq: number
  state: Record<string, unknown>
  timestamp: string // ISO 8601
}

/**
 * Event store port for event sourcing
 */
export interface EventStorePort {
  /**
   * Append an event to the event store
   */
  append(event: {
    aggregateId: string
    eventType: string
    payload: Record<string, unknown>
    metadata?: Record<string, unknown>
  }): Promise<Event>

  /**
   * Load events for an aggregate, optionally after a specific sequence number
   */
  load(args: {
    aggregateId: string
    afterSeq?: number
  }): Promise<Event[]>

  /**
   * Get the latest snapshot for an aggregate
   */
  latestSnapshot(args: {
    aggregateId: string
  }): Promise<Snapshot | null>

  /**
   * Save a snapshot for an aggregate
   */
  saveSnapshot(snapshot: {
    aggregateId: string
    lastSeq: number
    state: Record<string, unknown>
  }): Promise<void>
}

/**
 * Projection store port for read models
 */
export interface ProjectionStorePort {
  /**
   * Query a projection table with SQL
   * Returns rows as plain objects
   */
  query(args: {
    sql: string
    params?: unknown[]
  }): Promise<Array<Record<string, unknown>>>

  /**
   * Upsert rows into a projection table
   * Uses REPLACE INTO for SQLite (insert or replace)
   */
  upsert(args: {
    table: string
    rows: Array<Record<string, unknown>>
  }): Promise<void>

  /**
   * Truncate (delete all rows from) a projection table
   */
  truncate(args: {
    table: string
  }): Promise<void>
}

/**
 * Transaction port for running operations in a transaction
 */
export interface TxPort {
  /**
   * Run a function in a database transaction
   * If the function throws, the transaction is rolled back
   * If the function returns normally, the transaction is committed
   */
  runInTransaction<T>(fn: () => T | Promise<T>): Promise<T>
}

/**
 * Blob store port for storing large binary data (optional)
 */
export interface BlobStorePort {
  /**
   * Store a blob and return its key/id
   */
  put(args: {
    key: string
    data: Buffer
    contentType?: string
  }): Promise<void>

  /**
   * Retrieve a blob by key
   */
  get(args: {
    key: string
  }): Promise<{ data: Buffer; contentType?: string } | null>

  /**
   * Get blob metadata without retrieving the data
   */
  stat(args: {
    key: string
  }): Promise<{ size: number; contentType?: string } | null>
}

/**
 * Database context containing all ports
 */
export interface DbContext {
  eventStore: EventStorePort
  projectionStore: ProjectionStorePort
  tx: TxPort
  blobStore?: BlobStorePort
}

