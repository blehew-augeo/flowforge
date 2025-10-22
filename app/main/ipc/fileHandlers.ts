// File operation handlers

import { ipcMain, dialog } from 'electron'
import * as fs from 'fs'
import type { IpcContext } from './types'
import type { FilePreview } from '../types'
import { isValidFilePath } from '../utils/security'
import { parseCsv, parseXlsx } from '../parsers'

/**
 * Register file operation IPC handlers
 */
export function registerFileHandlers(_ctx: IpcContext): void {
  // Select file dialog
  ipcMain.handle('files:selectFile', async (_event, accept?: string) => {
    // Validate input
    if (accept && typeof accept !== 'string') {
      throw new Error('Invalid accept parameter')
    }

    const filters = accept === 'xlsx'
      ? [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
      : accept === 'csv'
      ? [{ name: 'CSV Files', extensions: ['csv'] }]
      : accept === 'data'
      ? [{ name: 'Data Files', extensions: ['xlsx', 'xls', 'csv'] }]
      : [{ name: 'All Files', extensions: ['*'] }]

    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  // Read file as base64
  ipcMain.handle('files:readFileBinary', async (_event, filePath: string) => {
    // Validate input
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('File path is required')
    }

    // Validate file path
    if (!isValidFilePath(filePath)) {
      throw new Error('Invalid file path')
    }
    
    const fsPromises = await import('fs/promises')
    try {
      const buffer = await fsPromises.readFile(filePath)
      return buffer.toString('base64')
    } catch (error) {
      throw new Error(`Failed to read binary file: ${(error as Error).message}`)
    }
  })

  // Preview file contents
  ipcMain.handle('files:previewFile', async (_event, filePath: string): Promise<FilePreview> => {
    // Validate input
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('File path is required')
    }

    // Validate file path
    if (!isValidFilePath(filePath)) {
      throw new Error('Invalid file path')
    }
    
    const ext = filePath.toLowerCase().split('.').pop()
    
    // Validate file extension to prevent arbitrary file access
    if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'csv') {
      throw new Error(`Unsupported file type: ${ext}`)
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error('File does not exist')
    }

    if (ext === 'xlsx' || ext === 'xls') {
      return parseXlsx(filePath)
    } else if (ext === 'csv') {
      return parseCsv(filePath)
    } else {
      throw new Error(`Unsupported file type: ${ext}`)
    }
  })
}

