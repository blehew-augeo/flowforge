// System operation handlers

import { ipcMain, app, shell } from 'electron'
import * as fs from 'fs'
import type { IpcContext } from './types'
import { isValidFilePath } from '../utils/security'

/**
 * Register system-related IPC handlers
 */
export function registerSystemHandlers(_ctx: IpcContext): void {
  // Open path in system default application
  ipcMain.handle('system:openPath', async (_event, pathToOpen: string) => {
    // Validate input
    if (!pathToOpen || typeof pathToOpen !== 'string') {
      throw new Error('Path is required')
    }

    // Validate path before opening
    if (!isValidFilePath(pathToOpen)) {
      throw new Error('Invalid path')
    }
    
    // Additional check: ensure path exists before opening
    if (!fs.existsSync(pathToOpen)) {
      throw new Error('Path does not exist')
    }
    
    const result = await shell.openPath(pathToOpen)
    
    // shell.openPath returns empty string on success, error message on failure
    if (result) {
      throw new Error(`Failed to open path: ${result}`)
    }
  })

  // Get application version
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })
}

