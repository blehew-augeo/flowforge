// IPC Context and shared types for IPC handlers

import type { CredsStore } from '../types'
import type { SettingsManager } from '../SettingsManager'
import type { DbContext } from '../db'

/**
 * Context passed to IPC registration functions
 * Contains dependencies needed by handlers
 */
export interface IpcContext {
  credsStore: CredsStore
  settingsManager: SettingsManager
  db?: DbContext // Optional for gradual migration
}

/**
 * Standard result wrapper for IPC operations
 */
export type IpcResult<T> = 
  | { ok: true; data: T }
  | { ok: false; error: string }

/**
 * Guard to prevent double registration
 */
let registered = false

export function markRegistered(): void {
  if (registered) {
    throw new Error('IPC handlers already registered - possible hot reload issue')
  }
  registered = true
}

export function isRegistered(): boolean {
  return registered
}

export function resetRegistration(): void {
  registered = false
}

