// Workflow orchestration and pipeline execution

import path from 'node:path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import * as XLSX from 'xlsx'
import log from 'electron-log'
import type { 
  PipelineConfig, 
  PipelineResult, 
  UserMetadata, 
  DataRow,
  NtlmCredentials,
  ApiUserMetadata
} from '../types'
import type { SettingsManager } from '../SettingsManager'
import { applyTransformRules } from '../transformRules'
import { makeNetworkRequest } from '../network'
import { validateRows } from '../validation'
import { writeCsv, writeXlsx } from '../writers'

/**
 * Extract unique ID GUIDs from data
 */
export function extractIdGuids(data: Array<Record<string, unknown>>, columnName: string = 'User Name'): string[] {
  const idguids = new Set<string>()
  
  for (const row of data) {
    const value = row[columnName]
    if (value) {
      const idguid = String(value).trim()
      if (idguid) {
        idguids.add(idguid)
      }
    }
  }
  
  return Array.from(idguids)
}

/**
 * Fetch user metadata from API
 */
export async function fetchUserMetadata(
  idguid: string,
  apiUrl: string,
  credentials: NtlmCredentials | undefined,
  cookieHeader?: string
): Promise<UserMetadata> {
  const endpoint = `${apiUrl}/SiteUser/GetUser/`
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json, */*',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  }
  
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader
    headers['Referer'] = apiUrl
  }
  
  const body = `idGuid=${encodeURIComponent(idguid)}`
  
  try {
    const response = await makeNetworkRequest(endpoint, 'POST', headers, body, credentials)
    
    if (response.status < 200 || response.status >= 300) {
      log.error(`[ERROR] Metadata request failed for ${idguid}`)
      log.error(`[ERROR] Status: ${response.status}`)
      log.error(`[ERROR] Headers:`, JSON.stringify(response.headers, null, 2))
      log.error(`[ERROR] Full response body:`, response.body)
      return { user_id: idguid, email: '' }
    }
    
    const contentType = String(response.headers['content-type'] || '')
    if (!contentType.toLowerCase().includes('application/json')) {
      log.error(`[ERROR] Non-JSON response for ${idguid}`)
      log.error(`[ERROR] Content-Type: ${contentType || 'unknown'}`)
      log.error(`[ERROR] Full response body:`, response.body)
      return { user_id: idguid, email: '' }
    }
    
    const data = JSON.parse(response.body) as ApiUserMetadata
    
    if (!data || !data.IDGUID) {
      log.error(`[ERROR] No IDGUID in response for ${idguid}`)
      log.error(`[ERROR] Status: ${response.status}`)
      log.error(`[ERROR] Headers:`, JSON.stringify(response.headers, null, 2))
      log.error(`[ERROR] Full response body:`, response.body)
      return { user_id: idguid, email: '' }
    }
    
    // Extract emails (primary + any metadata emails)
    const collectedEmails: string[] = []
    if (data.Email && data.Email.trim()) {
      collectedEmails.push(data.Email.trim())
    }
    if (data.Metadata) {
      for (const meta of data.Metadata) {
        if (meta.Name && meta.StoredValue && meta.Name.toLowerCase().includes('email')) {
          const v = meta.StoredValue.trim()
          if (v) collectedEmails.push(v)
        }
      }
    }
    
    const result: UserMetadata = {
      user_id: data.ExternalCode || data.UserName || idguid,
      email: collectedEmails[0] || '',
      emails: collectedEmails.length > 0 ? Array.from(new Set(collectedEmails)) : undefined
    }
    if (data.FirstName) result.first_name = data.FirstName
    if (data.LastName) result.last_name = data.LastName
    
    return result
  } catch (error) {
    log.error(`[ERROR] Failed to fetch metadata for ${idguid}`)
    log.error(`[ERROR] Request URL: ${endpoint}`)
    log.error(`[ERROR] Error details:`, error)
    return { user_id: idguid, email: '' }
  }
}

function extractCookieHeader(setCookieHeader: unknown): string | undefined {
  if (!setCookieHeader) return undefined
  const setCookies: string[] = Array.isArray(setCookieHeader)
    ? (setCookieHeader as string[])
    : [String(setCookieHeader)]
  const cookiePairs = setCookies
    .map(sc => sc.split(';')[0])
    .filter(Boolean)
  if (cookiePairs.length === 0) return undefined
  return cookiePairs.join('; ')
}

async function warmUpAdminSession(apiUrl: string, credentials: NtlmCredentials | undefined): Promise<string | undefined> {
  try {
    const headers: Record<string, string> = {
      'Accept': 'text/html, */*',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
    
    const response = await makeNetworkRequest(apiUrl, 'GET', headers, undefined, credentials)
    const cookieHeader = extractCookieHeader(response.headers['set-cookie'])
    return cookieHeader
  } catch (error) {
    log.error('[ERROR] Session warm-up failed:', error)
    return undefined
  }
}

/**
 * Fetch metadata for all users in batches
 */
export async function fetchAllMetadata(
  idguids: string[],
  apiUrl: string,
  credentials: NtlmCredentials | undefined,
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, UserMetadata>> {
  const metadata = new Map<string, UserMetadata>()
  // Establish NTLM session and capture cookies
  const cookieHeader = await warmUpAdminSession(apiUrl, credentials)
  
  // Fetch in batches to avoid overwhelming the server
  const batchSize = 10
  const batches: string[][] = []
  
  for (let i = 0; i < idguids.length; i += batchSize) {
    batches.push(idguids.slice(i, i + batchSize))
  }
  
  let completed = 0
  
  for (const batch of batches) {
    const promises = batch.map(idguid => fetchUserMetadata(idguid, apiUrl, credentials, cookieHeader))
    const results = await Promise.all(promises)
    
    results.forEach((result, idx) => {
      const idguid = batch[idx]
      if (idguid) {
        metadata.set(idguid, result)
      }
    })
    
    completed += batch.length
    if (onProgress) {
      onProgress(completed, idguids.length)
    }
  }
  return metadata
}

/**
 * Pipeline configuration with settings manager
 */
interface PipelineConfigWithSettings extends PipelineConfig {
  settingsManager: SettingsManager
}

/**
 * Run the complete data transformation pipeline
 */
export async function runPipeline(config: PipelineConfigWithSettings): Promise<PipelineResult> {
  const timings: Record<string, number> = {}
  const notes: string[] = []
  let startTime: number
  
  // Ensure artifact directory exists
  fs.mkdirSync(config.artifactDir, { recursive: true })
  
  const logPath = path.join(config.artifactDir, 'run.log')
  const logStream = fs.createWriteStream(logPath, { flags: 'w' })
  
  function log(_message: string): void {
    // info logging disabled; keep errors only via log.error paths
  }
  
  try {
    log('Pipeline started')
    log(`Input: ${config.inputPath}`)
    log(`Output: ${config.outputPath}`)
    log(`Format: ${config.outputFormat}`)
    
    // Use provided metadata (fetched via connection in workflow)
    let metadata: Map<string, UserMetadata> | undefined
    
    if (config.metadata) {
      metadata = config.metadata
      log(`Using ${metadata.size} provided metadata entries`)
    }
    
    // Step 1: Source - read input file
    startTime = Date.now()
    log('Step 1: Reading input file...')
    
    const ext = config.inputPath.toLowerCase().split('.').pop()
    let sourceData: DataRow[]
    
    if (ext === 'xlsx' || ext === 'xls') {
      // Read entire file, not just sample
      const fsPromises = await import('fs/promises')
      const buffer = await fsPromises.readFile(config.inputPath)
      const base64Content = buffer.toString('base64')
      const workbook = XLSX.read(base64Content, { type: 'base64' })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) throw new Error('No sheets found in workbook')
      const worksheet = workbook.Sheets[sheetName]
      if (!worksheet) throw new Error('Could not read worksheet')
      // Use raw: true to preserve exact string values (dates, postal codes, etc)
      sourceData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: true }) as DataRow[]
      log(`Read ${sourceData.length} rows from XLSX`)
    } else if (ext === 'csv') {
      // Read entire CSV file, not just sample
      const fsPromises = await import('fs/promises')
      const content = await fsPromises.readFile(config.inputPath, 'utf-8')
      // Read as string to preserve exact formatting from CSV
      const workbook = XLSX.read(content, { type: 'string', raw: true })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) throw new Error('No data found in CSV file')
      const worksheet = workbook.Sheets[sheetName]
      if (!worksheet) throw new Error('Could not read CSV data')
      sourceData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: true }) as DataRow[]
      log(`Read ${sourceData.length} rows from CSV`)
    } else {
      throw new Error(`Unsupported input format: ${ext}`)
    }
    
    timings['source'] = Date.now() - startTime
    log(`Source completed in ${timings['source']}ms`)
    
    // Step 2: Normalize (already done by parsers)
    startTime = Date.now()
    log('Step 2: Normalizing data...')
    const normalizedData = sourceData // Already normalized by parsers
    timings['normalize'] = Date.now() - startTime
    log(`Normalize completed in ${timings['normalize']}ms`)
    
    // Step 3: Enrich (stub - pass through)
    startTime = Date.now()
    log('Step 3: Enriching data (stub)...')
    const enrichedData = normalizedData // Stub: no enrichment
    timings['enrich'] = Date.now() - startTime
    log(`Enrich completed in ${timings['enrich']}ms`)
    
    // Step 4: Transform (apply rules)
    startTime = Date.now()
    log('Step 4: Applying transformation rules...')
    // Get settings for transformation rules
    const settings = config.settingsManager.getSettings()
    const transformedData = applyTransformRules(enrichedData, metadata, settings.emailDomainKeywords, settings.companyName)
    timings['transform'] = Date.now() - startTime
    log(`Transform completed in ${timings['transform']}ms`)
    
    // Step 5: Validate
    startTime = Date.now()
    log('Step 5: Validating data...')
    const validationErrors = validateRows(transformedData)
    timings['validate'] = Date.now() - startTime
    log(`Validate completed in ${timings['validate']}ms`)
    log(`Validation errors: ${validationErrors.length}`)
    
    // Step 6: Sink - write output file
    startTime = Date.now()
    log('Step 6: Writing output file...')
    
    if (config.outputFormat === 'xlsx') {
      writeXlsx(transformedData, config.outputPath)
    } else {
      writeCsv(transformedData, config.outputPath)
    }
    
    timings['sink'] = Date.now() - startTime
    log(`Sink completed in ${timings['sink']}ms`)
    
    // Calculate artifact hash
    const outputContent = fs.readFileSync(config.outputPath)
    const hash = crypto.createHash('sha256').update(outputContent).digest('hex')
    
    log('Pipeline completed successfully')
    log(`Artifact hash: ${hash}`)
    
    const counts = {
      in: sourceData.length,
      out: transformedData.length,
      errors: validationErrors.length
    }
    
    const result: PipelineResult = {
      ok: validationErrors.length === 0,
      artifactDir: config.artifactDir,
      reportPath: path.join(config.artifactDir, 'report.json'),
      counts,
      timings,
      notes,
      artifactHash: hash
    }
    
    // Write report.json with source and output data
    const reportWithData = {
      ...result,
      sourceDataSample: sourceData.slice(0, 100),
      outputDataSample: transformedData.slice(0, 100),
      sourceDataCount: sourceData.length,
      outputDataCount: transformedData.length,
    }
    fs.writeFileSync(result.reportPath, JSON.stringify(reportWithData, null, 2), 'utf-8')
    
    logStream.end()
    return result
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Pipeline failed: ${errorMessage}`)
    logStream.end()
    throw error
  }
}

/**
 * Generate a unique artifact directory path with timestamp
 */
export function generateArtifactDir(baseDir: string = 'artifacts'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
  return path.join(baseDir, `run-${timestamp}`)
}

