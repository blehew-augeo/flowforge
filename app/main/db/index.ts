// Database context singleton
// Exports the configured database ports for use throughout the application

import type { DbContext } from './ports'
import { eventStore, projectionStore, tx, blobStore, initDb, closeDb } from './sqliteAdapter'

/**
 * Database context singleton
 * Provides access to all database ports
 */
export const dbContext: DbContext = {
  eventStore,
  projectionStore,
  tx,
  blobStore
}

/**
 * Initialize the database
 * Must be called before using any database operations
 */
export { initDb, closeDb }

/**
 * Re-export types for convenience
 */
export type { DbContext, EventStorePort, ProjectionStorePort, TxPort, BlobStorePort, Event, Snapshot } from './ports'

