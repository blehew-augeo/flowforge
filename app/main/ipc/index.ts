// Main IPC registration module
// Coordinates registration of all IPC handlers

import log from 'electron-log'
import type { IpcContext } from './types'
import { isRegistered, markRegistered } from './types'
import { registerNetworkHandlers } from './networkHandlers'
import { registerConnectionHandlers } from './connectionHandlers'
import { registerFileHandlers } from './fileHandlers'
import { registerWorkflowHandlers } from './workflowHandlers'
import { registerSystemHandlers } from './systemHandlers'
import { registerSettingsHandlers } from './settingsHandlers'
import { registerDbHandlers } from './dbHandlers'

/**
 * Register all IPC handlers once
 * Guards against double registration on hot reload
 */
export function registerIpc(ctx: IpcContext): void {
  // Guard against double registration
  if (isRegistered()) {
    log.warn('[IPC] Handlers already registered - skipping re-registration')
    return
  }

  log.info('[IPC] Registering IPC handlers...')

  try {
    // Register all handler modules
    registerNetworkHandlers(ctx)
    registerConnectionHandlers(ctx)
    registerFileHandlers(ctx)
    registerWorkflowHandlers(ctx)
    registerSystemHandlers(ctx)
    registerSettingsHandlers(ctx)
    
    // Register database handlers if db context is provided
    if (ctx.db) {
      registerDbHandlers(ctx as IpcContext & { db: Required<IpcContext>['db'] })
    } else {
      log.warn('[IPC] Database context not provided - skipping DB handlers')
    }

    // Mark as registered to prevent duplicates
    markRegistered()

    log.info('[IPC] All IPC handlers registered successfully')
  } catch (error) {
    log.error('[IPC] Failed to register IPC handlers:', error)
    throw error
  }
}

// Export types for use in other modules
export type { IpcContext } from './types'

