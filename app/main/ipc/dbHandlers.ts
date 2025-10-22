// Database IPC handlers
// Exposes database operations to the renderer process

import { ipcMain } from 'electron'
import log from 'electron-log'
import type { IpcContext } from './types'
import type { DbContext, Event, Snapshot } from '../db'

/**
 * Register database IPC handlers
 */
export function registerDbHandlers(ctx: IpcContext & { db: DbContext }): void {
  // ============================================================================
  // EVENT STORE HANDLERS
  // ============================================================================

  // Append an event to the event store
  ipcMain.handle('db:appendEvent', async (_event, payload: {
    aggregateId: string
    eventType: string
    payload: Record<string, unknown>
    metadata?: Record<string, unknown>
  }): Promise<Event> => {
    // Validate input
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload')
    }

    if (!payload.aggregateId || typeof payload.aggregateId !== 'string') {
      throw new Error('aggregateId is required and must be a string')
    }

    if (!payload.eventType || typeof payload.eventType !== 'string') {
      throw new Error('eventType is required and must be a string')
    }

    if (!payload.payload || typeof payload.payload !== 'object') {
      throw new Error('payload is required and must be an object')
    }

    try {
      const event = await ctx.db.eventStore.append({
        aggregateId: payload.aggregateId,
        eventType: payload.eventType,
        payload: payload.payload,
        metadata: payload.metadata
      })

      log.info('[DB] Event appended:', event.aggregateId, event.eventType, event.seq)
      return event
    } catch (error) {
      log.error('[DB] Failed to append event:', error)
      throw error
    }
  })

  // Load events for an aggregate
  ipcMain.handle('db:loadEvents', async (_event, args: {
    aggregateId: string
    afterSeq?: number
  }): Promise<Event[]> => {
    // Validate input
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments')
    }

    if (!args.aggregateId || typeof args.aggregateId !== 'string') {
      throw new Error('aggregateId is required and must be a string')
    }

    if (args.afterSeq !== undefined && typeof args.afterSeq !== 'number') {
      throw new Error('afterSeq must be a number')
    }

    try {
      const events = await ctx.db.eventStore.load({
        aggregateId: args.aggregateId,
        afterSeq: args.afterSeq
      })

      log.info('[DB] Loaded', events.length, 'events for aggregate:', args.aggregateId)
      return events
    } catch (error) {
      log.error('[DB] Failed to load events:', error)
      throw error
    }
  })

  // Get latest snapshot for an aggregate
  ipcMain.handle('db:latestSnapshot', async (_event, args: {
    aggregateId: string
  }): Promise<Snapshot | null> => {
    // Validate input
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments')
    }

    if (!args.aggregateId || typeof args.aggregateId !== 'string') {
      throw new Error('aggregateId is required and must be a string')
    }

    try {
      const snapshot = await ctx.db.eventStore.latestSnapshot({
        aggregateId: args.aggregateId
      })

      if (snapshot) {
        log.info('[DB] Loaded snapshot for aggregate:', args.aggregateId, 'at seq:', snapshot.lastSeq)
      } else {
        log.info('[DB] No snapshot found for aggregate:', args.aggregateId)
      }

      return snapshot
    } catch (error) {
      log.error('[DB] Failed to load snapshot:', error)
      throw error
    }
  })

  // Save a snapshot for an aggregate
  ipcMain.handle('db:saveSnapshot', async (_event, snapshot: {
    aggregateId: string
    lastSeq: number
    state: Record<string, unknown>
  }): Promise<void> => {
    // Validate input
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('Invalid snapshot')
    }

    if (!snapshot.aggregateId || typeof snapshot.aggregateId !== 'string') {
      throw new Error('aggregateId is required and must be a string')
    }

    if (typeof snapshot.lastSeq !== 'number') {
      throw new Error('lastSeq is required and must be a number')
    }

    if (!snapshot.state || typeof snapshot.state !== 'object') {
      throw new Error('state is required and must be an object')
    }

    try {
      await ctx.db.eventStore.saveSnapshot({
        aggregateId: snapshot.aggregateId,
        lastSeq: snapshot.lastSeq,
        state: snapshot.state
      })

      log.info('[DB] Snapshot saved for aggregate:', snapshot.aggregateId, 'at seq:', snapshot.lastSeq)
    } catch (error) {
      log.error('[DB] Failed to save snapshot:', error)
      throw error
    }
  })

  // ============================================================================
  // PROJECTION STORE HANDLERS
  // ============================================================================

  // Query a projection table
  ipcMain.handle('db:queryProjection', async (_event, args: {
    sql: string
    params?: unknown[]
  }): Promise<Array<Record<string, unknown>>> => {
    // Validate input
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments')
    }

    if (!args.sql || typeof args.sql !== 'string') {
      throw new Error('sql is required and must be a string')
    }

    if (args.params !== undefined && !Array.isArray(args.params)) {
      throw new Error('params must be an array')
    }

    // Security: only allow SELECT queries
    const trimmedSql = args.sql.trim().toLowerCase()
    if (!trimmedSql.startsWith('select')) {
      throw new Error('Only SELECT queries are allowed via queryProjection')
    }

    try {
      const rows = await ctx.db.projectionStore.query({
        sql: args.sql,
        params: args.params
      })

      log.info('[DB] Query returned', rows.length, 'rows')
      return rows
    } catch (error) {
      log.error('[DB] Failed to query projection:', error)
      throw error
    }
  })

  // Upsert rows into a projection table
  ipcMain.handle('db:upsertProjection', async (_event, args: {
    table: string
    rows: Array<Record<string, unknown>>
  }): Promise<void> => {
    // Validate input
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments')
    }

    if (!args.table || typeof args.table !== 'string') {
      throw new Error('table is required and must be a string')
    }

    if (!Array.isArray(args.rows)) {
      throw new Error('rows must be an array')
    }

    // Validate table name (prevent SQL injection)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(args.table)) {
      throw new Error(`Invalid table name: ${args.table}`)
    }

    try {
      await ctx.db.projectionStore.upsert({
        table: args.table,
        rows: args.rows
      })

      log.info('[DB] Upserted', args.rows.length, 'rows into table:', args.table)
    } catch (error) {
      log.error('[DB] Failed to upsert projection:', error)
      throw error
    }
  })

  // Truncate a projection table
  ipcMain.handle('db:truncateProjection', async (_event, args: {
    table: string
  }): Promise<void> => {
    // Validate input
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments')
    }

    if (!args.table || typeof args.table !== 'string') {
      throw new Error('table is required and must be a string')
    }

    // Validate table name (prevent SQL injection)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(args.table)) {
      throw new Error(`Invalid table name: ${args.table}`)
    }

    try {
      await ctx.db.projectionStore.truncate({
        table: args.table
      })

      log.info('[DB] Truncated table:', args.table)
    } catch (error) {
      log.error('[DB] Failed to truncate projection:', error)
      throw error
    }
  })

  // ============================================================================
  // TRANSACTION HANDLER (Advanced use case)
  // ============================================================================

  // Note: Transactions are typically managed in the main process, not exposed via IPC
  // This is a placeholder for future advanced use cases
  // For now, transactions should be used in main process handlers only
}

