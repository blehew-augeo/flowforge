// Application settings handlers

import { ipcMain } from 'electron'
import type { IpcContext } from './types'
import type { AppSettings } from '../types'

/**
 * Register settings-related IPC handlers
 */
export function registerSettingsHandlers(ctx: IpcContext): void {
  // Get current settings
  ipcMain.handle('settings:get', async () => {
    return ctx.settingsManager.getSettings()
  })

  // Update settings (partial update)
  ipcMain.handle('settings:update', async (_event, updates: Partial<AppSettings>) => {
    // Validate input
    if (!updates || typeof updates !== 'object') {
      throw new Error('Invalid settings object')
    }

    // Validate individual fields if present
    if (updates.companyName !== undefined && typeof updates.companyName !== 'string') {
      throw new Error('Invalid company name')
    }

    if (updates.defaultApiUrl !== undefined && typeof updates.defaultApiUrl !== 'string') {
      throw new Error('Invalid API URL')
    }

    if (updates.emailDomainKeywords !== undefined) {
      if (!Array.isArray(updates.emailDomainKeywords)) {
        throw new Error('Email domain keywords must be an array')
      }
      for (const keyword of updates.emailDomainKeywords) {
        if (typeof keyword !== 'string') {
          throw new Error('Email domain keywords must be strings')
        }
      }
    }

    ctx.settingsManager.updateSettings(updates)
  })

  // Reset settings to defaults
  ipcMain.handle('settings:reset', async () => {
    ctx.settingsManager.resetSettings()
  })
}

