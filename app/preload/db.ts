// Database preload bindings
// Exposes typed database API to the renderer process via contextBridge

import { ipcRenderer } from 'electron'

/**
 * Event for event sourcing
 */
export interface Event {
  aggregateId: string
  seq: number
  eventType: string
  payload: Record<string, unknown>
  timestamp: string
  metadata?: Record<string, unknown>
}

/**
 * Snapshot for event sourcing
 */
export interface Snapshot {
  aggregateId: string
  lastSeq: number
  state: Record<string, unknown>
  timestamp: string
}

/**
 * Database API exposed to renderer
 */
export const dbApi = {
  // Event store operations
  appendEvent: (payload: {
    aggregateId: string
    eventType: string
    payload: Record<string, unknown>
    metadata?: Record<string, unknown>
  }): Promise<Event> => ipcRenderer.invoke('db:appendEvent', payload),

  loadEvents: (args: {
    aggregateId: string
    afterSeq?: number
  }): Promise<Event[]> => ipcRenderer.invoke('db:loadEvents', args),

  latestSnapshot: (args: {
    aggregateId: string
  }): Promise<Snapshot | null> => ipcRenderer.invoke('db:latestSnapshot', args),

  saveSnapshot: (snapshot: {
    aggregateId: string
    lastSeq: number
    state: Record<string, unknown>
  }): Promise<void> => ipcRenderer.invoke('db:saveSnapshot', snapshot),

  // Projection store operations
  queryProjection: (args: {
    sql: string
    params?: unknown[]
  }): Promise<Array<Record<string, unknown>>> => ipcRenderer.invoke('db:queryProjection', args),

  upsertProjection: (args: {
    table: string
    rows: Array<Record<string, unknown>>
  }): Promise<void> => ipcRenderer.invoke('db:upsertProjection', args),

  truncateProjection: (args: {
    table: string
  }): Promise<void> => ipcRenderer.invoke('db:truncateProjection', args)
}

/**
 * Type definition for the database API
 */
export type DbApi = typeof dbApi

