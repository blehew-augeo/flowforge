// Workflow orchestration handlers

import { ipcMain } from 'electron'
import path from 'node:path'
import * as XLSX from 'xlsx'
import log from 'electron-log'
import type { IpcContext } from './types'
import { isValidFilePath, isValidUrl, sanitizeString } from '../utils/security'
import { runPipeline, generateArtifactDir, extractIdGuids, fetchAllMetadata } from '../workflow'

/**
 * Register workflow-related IPC handlers
 */
export function registerWorkflowHandlers(ctx: IpcContext): void {
  // Run complete workflow
  ipcMain.handle('workflow:run', async (_event, request: { 
    inputPath: string
    connectionName: string
    apiUrl: string 
  }) => {
    try {
      // Validate inputs
      if (!request || typeof request !== 'object') {
        throw new Error('Invalid request object')
      }

      if (!request.inputPath || typeof request.inputPath !== 'string') {
        throw new Error('Input path is required')
      }

      if (!request.apiUrl || typeof request.apiUrl !== 'string') {
        throw new Error('API URL is required')
      }

      if (!request.connectionName || typeof request.connectionName !== 'string') {
        throw new Error('Connection name is required')
      }

      if (!isValidFilePath(request.inputPath)) {
        throw new Error('Invalid input file path')
      }
      
      if (!isValidUrl(request.apiUrl)) {
        throw new Error('Invalid API URL')
      }
      
      // Sanitize connection name
      const connectionName = sanitizeString(request.connectionName, 255)
      if (!connectionName) {
        throw new Error('Invalid connection name')
      }
      
      const fsPromises = await import('fs/promises')
      
      // Prepare artifact directory early to store diagnostics if needed
      const artifactDir = generateArtifactDir('artifacts')
      
      // Read the input file to extract IDGUIDs
      const ext = request.inputPath.toLowerCase().split('.').pop()
      let sourceData: Array<Record<string, unknown>>
      
      if (ext === 'xlsx' || ext === 'xls') {
        // Read file as base64 and parse with XLSX
        const buffer = await fsPromises.readFile(request.inputPath)
        const base64Content = buffer.toString('base64')
        const workbook = XLSX.read(base64Content, { type: 'base64' })
        const sheetName = workbook.SheetNames[0]
        if (!sheetName) throw new Error('No sheets found in workbook')
        const worksheet = workbook.Sheets[sheetName]
        if (!worksheet) throw new Error('Could not read worksheet')
        sourceData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: true }) as Array<Record<string, unknown>>
      } else if (ext === 'csv') {
        const content = await fsPromises.readFile(request.inputPath, 'utf-8')
        const workbook = XLSX.read(content, { type: 'string', raw: true })
        const sheetName = workbook.SheetNames[0]
        if (!sheetName) throw new Error('No data found in CSV file')
        const worksheet = workbook.Sheets[sheetName]
        if (!worksheet) throw new Error('Could not read CSV data')
        sourceData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: true }) as Array<Record<string, unknown>>
      } else {
        throw new Error(`Unsupported file type: ${ext}`)
      }
      
      // Extract IDGUIDs
      const idguids = extractIdGuids(sourceData, 'User Name')
      
      // Fetch metadata from API using saved connection credentials (if any)
      // If no credentials are saved, Windows integrated auth will be used
      log.info('[WORKFLOW] Retrieving credentials for connection:', connectionName)
      const credentials = await ctx.credsStore.get(connectionName)
      log.info('[WORKFLOW] Credentials found:', !!credentials)
      if (credentials) {
        log.info('[WORKFLOW] Using credentials - Domain:', credentials.domain, 'Username:', credentials.username)
      } else {
        log.info('[WORKFLOW] No credentials found - will use Windows Integrated Auth')
      }
      
      log.info('[WORKFLOW] Fetching metadata for', idguids.length, 'users from:', request.apiUrl)
      const metadata = await fetchAllMetadata(idguids, request.apiUrl, credentials || undefined)
      log.info('[WORKFLOW] Metadata fetch complete. Retrieved', metadata.size, 'entries')
      
      // Coverage gate: ensure we have usable metadata for all IDs
      const missingIds: string[] = []
      for (const id of idguids) {
        const m = metadata.get(id)
        const hasAnyEmail = !!(m && (m.email || (m.emails && m.emails.length > 0)))
        if (!hasAnyEmail) missingIds.push(id)
      }
      if (missingIds.length > 0) {
        const diagPath = path.join(artifactDir, 'metadata_diagnostics.txt')
        const reportLines = [
          `Total IDs: ${idguids.length}`,
          `Resolved metadata entries: ${idguids.length - missingIds.length}`,
          `Missing metadata entries: ${missingIds.length}`,
          '',
          'IDs with missing metadata:',
          ...missingIds
        ]
        await fsPromises.mkdir(artifactDir, { recursive: true })
        await fsPromises.writeFile(diagPath, reportLines.join('\n'), 'utf-8')
        return {
          ok: false,
          artifactDir,
          reportPath: '',
          error: `Metadata incomplete for ${missingIds.length} of ${idguids.length} IDs. See metadata_diagnostics.txt`
        }
      }
      
      // Generate artifact directory
      const outputExt = ext === 'csv' ? 'csv' : 'xlsx'
      
      // Run pipeline with fetched metadata
      const config = {
        inputPath: request.inputPath,
        outputPath: `${artifactDir}/output.${outputExt}`,
        outputFormat: outputExt as 'csv' | 'xlsx',
        artifactDir,
        metadata,
        settingsManager: ctx.settingsManager
      }
      
      const result = await runPipeline(config)
      
      // Convert to absolute paths
      const absoluteArtifactDir = path.isAbsolute(result.artifactDir) 
        ? result.artifactDir 
        : path.resolve(process.cwd(), result.artifactDir)
      const absoluteReportPath = path.isAbsolute(result.reportPath)
        ? result.reportPath
        : path.resolve(process.cwd(), result.reportPath)
      
      return {
        ok: result.ok,
        artifactDir: absoluteArtifactDir,
        reportPath: absoluteReportPath
      }
    } catch (error) {
      log.error('[ERROR] Workflow failed')
      log.error('[ERROR] Error details:', error)
      return {
        ok: false,
        artifactDir: '',
        reportPath: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
}

