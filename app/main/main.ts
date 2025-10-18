import { app, BrowserWindow, ipcMain, dialog, session, net } from 'electron'
import path from 'node:path'
import { URL } from 'node:url'
import * as fs from 'fs'
import * as crypto from 'crypto'
import keytar from 'keytar'
import * as XLSX from 'xlsx'
import pkg from 'electron-updater'
const { autoUpdater } = pkg

// =============================================================================
// SETTINGS MANAGER
// =============================================================================

export interface AppSettings {
  companyName: string
  defaultApiUrl: string
  emailDomainKeywords: string[]
}

const DEFAULT_SETTINGS: AppSettings = {
  companyName: '',
  defaultApiUrl: '',
  emailDomainKeywords: []
}

class SettingsManager {
  private settingsPath: string
  private settings: AppSettings

  constructor() {
    // Store settings in user data directory
    const userDataPath = app.getPath('userData')
    this.settingsPath = path.join(userDataPath, 'app-settings.json')
    this.settings = this.loadSettings()
  }

  private loadSettings(): AppSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf-8')
        const loaded = JSON.parse(data) as Partial<AppSettings>
        
        // Merge with defaults to ensure all fields exist
        return {
          ...DEFAULT_SETTINGS,
          ...loaded
        }
      }
    } catch (error) {
      console.error('[ERROR] Failed to load settings:', error)
    }
    
    return { ...DEFAULT_SETTINGS }
  }

  private saveSettings(): void {
    try {
      const userDataPath = app.getPath('userData')
      fs.mkdirSync(userDataPath, { recursive: true })
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (error) {
      console.error('[ERROR] Failed to save settings:', error)
      throw error
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  updateSettings(updates: Partial<AppSettings>): void {
    this.settings = {
      ...this.settings,
      ...updates
    }
    this.saveSettings()
  }

  resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS }
    this.saveSettings()
  }
}

// Global settings manager instance
let settingsManager: SettingsManager

export function getSettingsManager(): SettingsManager {
  if (!settingsManager) {
    settingsManager = new SettingsManager()
  }
  return settingsManager
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

// Core data types
export type DataRow = Record<string, unknown>

export interface NtlmCredentials {
  domain: string
  username: string
  password: string
}

export interface UserMetadata {
  user_id: string
  email: string
  emails?: string[] | undefined
  first_name?: string
  last_name?: string
}

export interface PipelineConfig {
  inputPath: string
  outputPath: string
  outputFormat: 'xlsx' | 'csv'
  artifactDir: string
  metadata?: Map<string, UserMetadata>
}

export interface PipelineResult {
  ok: boolean
  artifactDir: string
  reportPath: string
  counts: {
    in: number
    out: number
    errors: number
  }
  timings: Record<string, number>
  notes: string[]
  artifactHash: string
}

export interface ValidationError {
  row: number
  field: string
  message: string
}

export interface FilePreview {
  name: string
  rows: number
  sample: Array<Record<string, unknown>>
}

export type HttpAuth = {
  kind: 'none' | 'basic' | 'bearer' | 'ntlm'
  username?: string
  password?: string
  domain?: string
  workstation?: string
  token?: string
}

export type HttpReq = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  auth?: HttpAuth
}

export type HttpRes = {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  bodyText: string
}

export type NetworkRequest = {
  method?: string
  url: string
  headers?: Record<string, string>
  body?: string
  connectionId?: string
}

export type NetworkResponse = {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  bodyText: string
}

export type AuthPreflightMode = 'silent-ok' | 'auth-required' | 'needs-vpn' | 'unreachable'

export interface AuthPreflightRequest {
  connectionId: string
  baseUrl: string
}

export interface AuthPreflightResponse {
  mode: AuthPreflightMode
  details?: string
}

export interface AuthProvideCredentialsRequest {
  connectionId: string
  baseUrl: string
  domain: string
  username: string
  password: string
}

export interface AuthProvideCredentialsResponse {
  ok: boolean
  error?: string
}

interface ApiUserMetadata {
  IDGUID: string
  FirstName?: string
  LastName?: string
  UserName?: string
  ExternalCode?: string
  Email?: string
  Metadata?: Array<{
    Name: string
    StoredValue: string
  }>
}

interface UserMetadataFull {
  user_id: string
  email: string
  emails?: string[] | undefined
  first_name?: string
  last_name?: string
}

// =============================================================================
// CREDENTIALS STORE
// =============================================================================

export interface CredsStore {
  save(name: string, creds: NtlmCredentials): Promise<void>
  has(name: string): Promise<boolean>
  del(name: string): Promise<boolean>
  list(): Promise<string[]>
  get(name: string): Promise<NtlmCredentials | null>
}

const SERVICE_NAME = 'dws/ntlm'

export class KeytarCredsStore implements CredsStore {
  async save(name: string, creds: NtlmCredentials): Promise<void> {
    const secret = JSON.stringify(creds)
    await keytar.setPassword(SERVICE_NAME, name, secret)
  }

  async has(name: string): Promise<boolean> {
    const password = await keytar.getPassword(SERVICE_NAME, name)
    return password !== null
  }

  async del(name: string): Promise<boolean> {
    return await keytar.deletePassword(SERVICE_NAME, name)
  }

  async list(): Promise<string[]> {
    const credentials = await keytar.findCredentials(SERVICE_NAME)
    return credentials.map(c => c.account)
  }

  async get(name: string): Promise<NtlmCredentials | null> {
    const secret = await keytar.getPassword(SERVICE_NAME, name)
    if (secret === null) {
      return null
    }
    try {
      return JSON.parse(secret) as NtlmCredentials
    } catch {
      return null
    }
  }
}

// In-memory store for testing
export class InMemoryCredsStore implements CredsStore {
  private store: Map<string, NtlmCredentials> = new Map()

  async save(name: string, creds: NtlmCredentials): Promise<void> {
    this.store.set(name, creds)
  }

  async has(name: string): Promise<boolean> {
    return this.store.has(name)
  }

  async del(name: string): Promise<boolean> {
    return this.store.delete(name)
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  async get(name: string): Promise<NtlmCredentials | null> {
    return this.store.get(name) ?? null
  }

  // Test utility to clear all
  clear(): void {
    this.store.clear()
  }
}

// Global instance - can be swapped for testing
let credsStoreInstance: CredsStore = new KeytarCredsStore()

// Connection registry to track all connections (with or without credentials)
const connectionRegistry = new Set<string>()

export function getCredsStore(): CredsStore {
  return credsStoreInstance
}

export function setCredsStore(store: CredsStore): void {
  credsStoreInstance = store
}

export function registerConnection(name: string): void {
  connectionRegistry.add(name)
}

export function unregisterConnection(name: string): void {
  connectionRegistry.delete(name)
}

export function listConnections(): string[] {
  return Array.from(connectionRegistry)
}

// =============================================================================
// NETWORK LAYER (Using Electron Session)
// =============================================================================

// Global storage for pending auth requests
const pendingAuthRequests = new Map<string, NtlmCredentials>()

// Make HTTP request using Electron's net API
async function makeNetworkRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  credentials?: NtlmCredentials
): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: method.toUpperCase(),
      url: url,
      session: session.defaultSession
    })

    // Set headers
    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value)
    }

    // Store credentials for potential auth challenge
    if (credentials) {
      pendingAuthRequests.set(url, credentials)
    }

    let responseData = ''
    let responseStatus = 0
    let responseStatusText = ''
    const responseHeaders: Record<string, string> = {}

    request.on('response', (response) => {
      responseStatus = response.statusCode
      responseStatusText = response.statusMessage

      // Collect headers
      const headerNames = response.rawHeaders
      for (let i = 0; i < headerNames.length; i += 2) {
        const name = headerNames[i]
        const value = headerNames[i + 1]
        if (name && value) {
          responseHeaders[name.toLowerCase()] = value
        }
      }

      response.on('data', (chunk) => {
        responseData += chunk.toString()
      })

      response.on('end', () => {
        pendingAuthRequests.delete(url)
        resolve({
          status: responseStatus,
          statusText: responseStatusText,
          headers: responseHeaders,
          body: responseData
        })
      })
    })

    request.on('error', (error) => {
      pendingAuthRequests.delete(url)
      reject(error)
    })

    // Send body if present
    if (body && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT' || method.toUpperCase() === 'PATCH')) {
      request.write(body)
    }

    request.end()
  })
}

// =============================================================================
// METADATA (Fetched via Connection)
// =============================================================================

// =============================================================================
// METADATA FETCHING
// =============================================================================

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
      console.error(`[ERROR] Metadata request failed for ${idguid}`)
      console.error(`[ERROR] Status: ${response.status}`)
      console.error(`[ERROR] Headers:`, JSON.stringify(response.headers, null, 2))
      console.error(`[ERROR] Full response body:`, response.body)
      return { user_id: idguid, email: '' }
    }
    
    const contentType = String(response.headers['content-type'] || '')
    if (!contentType.toLowerCase().includes('application/json')) {
      console.error(`[ERROR] Non-JSON response for ${idguid}`)
      console.error(`[ERROR] Content-Type: ${contentType || 'unknown'}`)
      console.error(`[ERROR] Full response body:`, response.body)
      return { user_id: idguid, email: '' }
    }
    
    const data = JSON.parse(response.body) as ApiUserMetadata
    
    if (!data || !data.IDGUID) {
      console.error(`[ERROR] No IDGUID in response for ${idguid}`)
      console.error(`[ERROR] Status: ${response.status}`)
      console.error(`[ERROR] Headers:`, JSON.stringify(response.headers, null, 2))
      console.error(`[ERROR] Full response body:`, response.body)
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
    console.error(`[ERROR] Failed to fetch metadata for ${idguid}`)
    console.error(`[ERROR] Request URL: ${endpoint}`)
    console.error(`[ERROR] Error details:`, error)
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
    console.error('[ERROR] Session warm-up failed:', error)
    return undefined
  }
}

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

// =============================================================================
// FILE PARSERS
// =============================================================================

function normalizeValueCsv(value: unknown): unknown {
  if (value === null || value === undefined || value === '') {
    return null
  }

  // Try to parse as number
  if (typeof value === 'string') {
    const trimmed = value.trim()
    
    // Check for boolean
    if (trimmed.toLowerCase() === 'true') return true
    if (trimmed.toLowerCase() === 'false') return false
    
    // Check for number
    const num = Number(trimmed)
    if (!isNaN(num) && trimmed !== '') {
      return num
    }
    
    // Check for date (ISO format)
    const dateRegex = /^\d{4}-\d{2}-\d{2}/
    if (dateRegex.test(trimmed)) {
      const date = new Date(trimmed)
      if (!isNaN(date.getTime())) {
        return date.toISOString()
      }
    }
    
    return trimmed
  }

  // Handle dates
  if (value instanceof Date) {
    return value.toISOString()
  }

  // Handle numbers
  if (typeof value === 'number') {
    return value
  }

  // Handle booleans
  if (typeof value === 'boolean') {
    return value
  }

  return String(value)
}

function normalizeValueXlsx(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null
  }

  // Handle dates - convert to ISO UTC string
  if (value instanceof Date) {
    return value.toISOString()
  }

  // Handle numbers
  if (typeof value === 'number') {
    return value
  }

  // Handle booleans
  if (typeof value === 'boolean') {
    return value
  }

  // Everything else as string
  return String(value)
}

export function parseCsv(filePath: string): FilePreview {
  const buffer = fs.readFileSync(filePath, 'utf-8')
  
  // Use XLSX to parse CSV (it handles CSV parsing well)
  const workbook = XLSX.read(buffer, { type: 'string', raw: false })
  
  // Get first sheet (CSV files only have one sheet)
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('No data found in CSV file')
  }

  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) {
    throw new Error('Could not read CSV data')
  }

  // Convert to JSON with header row
  const data = XLSX.utils.sheet_to_json(worksheet, {
    raw: false, // Get formatted values
    defval: null // Default value for empty cells
  })

  // Normalize all values
  const normalizedData = data.map(row => {
    const normalized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      normalized[key] = normalizeValueCsv(value)
    }
    return normalized
  })

  // Get first 100 rows for preview
  const sample = normalizedData.slice(0, 100)

  // Extract filename from path
  const name = filePath.split(/[/\\]/).pop() || filePath

  return {
    name,
    rows: normalizedData.length,
    sample
  }
}

export function parseXlsx(filePath: string): FilePreview {
  const buffer = fs.readFileSync(filePath)
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  
  // Get first sheet
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('No sheets found in workbook')
  }

  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) {
    throw new Error('Could not read worksheet')
  }

  // Convert to JSON with header row
  const data = XLSX.utils.sheet_to_json(worksheet, { 
    raw: false, // Convert to appropriate types
    defval: null // Default value for empty cells
  })

  // Normalize all values
  const normalizedData = data.map(row => {
    const normalized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      normalized[key] = normalizeValueXlsx(value)
    }
    return normalized
  })

  // Get first 100 rows for preview
  const sample = normalizedData.slice(0, 100)

  // Extract filename from path
  const name = filePath.split(/[/\\]/).pop() || filePath

  return {
    name,
    rows: normalizedData.length,
    sample
  }
}

// =============================================================================
// FILE WRITERS
// =============================================================================

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  
  const str = String(value)
  
  // If contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  
  return str
}

export function writeCsv(data: DataRow[], outputPath: string): void {
  if (data.length === 0) {
    throw new Error('Cannot write empty dataset to CSV')
  }

  // Get all unique keys from all rows
  const allKeys = new Set<string>()
  for (const row of data) {
    for (const key of Object.keys(row)) {
      allKeys.add(key)
    }
  }
  const headers = Array.from(allKeys)

  // Build CSV content
  const lines: string[] = []
  
  // Add header row
  lines.push(headers.map(h => escapeCsvValue(h)).join(','))
  
  // Add data rows
  for (const row of data) {
    const values = headers.map(h => escapeCsvValue(row[h]))
    lines.push(values.join(','))
  }
  
  // Write to file (add newline at end for proper file format)
  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf-8')
}

export function writeXlsx(data: DataRow[], outputPath: string): void {
  if (data.length === 0) {
    throw new Error('Cannot write empty dataset to XLSX')
  }

  // Create workbook
  const workbook = XLSX.utils.book_new()
  
  // Convert data to worksheet
  const worksheet = XLSX.utils.json_to_sheet(data)
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Results')
  
  // Write to file
  XLSX.writeFile(workbook, outputPath)
}

// =============================================================================
// VALIDATION
// =============================================================================

export function validateRows(rows: DataRow[]): ValidationError[] {
  const errors: ValidationError[] = []
  
  // Stub implementation - returns 0 errors
  // In a real implementation, this would check for:
  // - Required fields
  // - Data types
  // - Business rules
  // - Referential integrity
  
  return errors
}

// =============================================================================
// TRANSFORMATION RULES
// =============================================================================

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

function extractNameParts(email: string): Set<string> {
  if (!email || !email.includes('@')) {
    return new Set()
  }
  
  const emailParts = email.split('@')
  const localPart = (emailParts[0] || '').toLowerCase()
  const parts = new Set<string>()
  
  for (const separator of ['.', '_', '-', '+']) {
    localPart.split(separator).forEach(part => {
      if (part.trim()) {
        parts.add(part.trim())
      }
    })
  }
  
  return parts
}

function checkEmailMatchesMetadata(orderEmail: string, primaryEmailOrList: string | string[] | undefined): boolean {
  if (!orderEmail || !primaryEmailOrList) return false
  const normalizedOrder = normalizeEmail(orderEmail)
  if (Array.isArray(primaryEmailOrList)) {
    return primaryEmailOrList.some(e => e && normalizeEmail(e) === normalizedOrder)
  }
  return normalizeEmail(primaryEmailOrList) === normalizedOrder
}

function checkEmailContainsName(orderEmail: string, firstName?: string, lastName?: string): boolean {
  if (!orderEmail) {
    return false
  }
  
  const emailParts = extractNameParts(orderEmail)
  
  if (firstName) {
    const firstLower = firstName.toLowerCase().trim()
    if (emailParts.has(firstLower) || Array.from(emailParts).some(part => part.includes(firstLower))) {
      return true
    }
  }
  
  if (lastName) {
    const lastLower = lastName.toLowerCase().trim()
    if (emailParts.has(lastLower) || Array.from(emailParts).some(part => part.includes(lastLower))) {
      return true
    }
  }
  
  return false
}

function checkCompanyDomain(orderEmail: string, domainKeywords: string[]): boolean {
  if (!orderEmail || !orderEmail.includes('@')) {
    return false
  }
  
  if (!domainKeywords || domainKeywords.length === 0) {
    return false
  }
  
  const emailParts = orderEmail.split('@')
  const domain = (emailParts[1] || '').toLowerCase()
  
  // Check if domain contains any of the configured keywords
  return domainKeywords.some(keyword => domain.includes(keyword.toLowerCase()))
}

function checkSocialGood(productType: string): boolean {
  if (!productType) return false
  return productType.trim().toLowerCase() === 'social good'
}

export function applyTransformRules(rows: DataRow[], metadata?: Map<string, UserMetadataFull>, domainKeywords?: string[], companyName?: string): DataRow[] {
  return rows.map(row => {
    const orderEmail = String(row['Email Address'] || '')
    const userIdGuid = String(row['User Name'] || '')
    const productType = String(row['Product Type'] || '')
    
    let decision = 'N'
    let reason = 'No verification rule matched'
    
    // Get user metadata if available
    const userMeta = metadata?.get(userIdGuid)
    
    // Rule 1: Email matches metadata (requires user metadata)
    if (userMeta && checkEmailMatchesMetadata(orderEmail, userMeta.emails ?? userMeta.email)) {
      decision = 'Y'
      reason = 'Email matches user metadata'
    }
    // Rule 2: Email contains user's name (requires user metadata)
    else if (userMeta && checkEmailContainsName(orderEmail, userMeta.first_name, userMeta.last_name)) {
      decision = 'Y'
      const fullName = `${userMeta.first_name || ''} ${userMeta.last_name || ''}`.trim()
      reason = `Email contains user name (${fullName})`
    }
    // Rule 3: Company domain (does NOT require user metadata)
    else if (domainKeywords && domainKeywords.length > 0 && checkCompanyDomain(orderEmail, domainKeywords)) {
      decision = 'Y'
      const displayName = companyName || 'company'
      reason = `Email is under ${displayName} domain`
    }
    // Rule 4: Social Good product (does NOT require user metadata)
    else if (checkSocialGood(productType)) {
      decision = 'Y'
      reason = 'Product type is Social Good'
    }
    


    // Create output row with Decision and Reason first
    const outputRow: DataRow = {
      'Decision': decision,
      'Reason': reason
    }
    
    // Copy all other fields in their original order
    for (const [key, value] of Object.entries(row)) {
      outputRow[key] = value
    }
    
    return outputRow
  })
}

// =============================================================================
// PIPELINE ORCHESTRATOR
// =============================================================================

export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const timings: Record<string, number> = {}
  const notes: string[] = []
  let startTime: number
  
  // Ensure artifact directory exists
  fs.mkdirSync(config.artifactDir, { recursive: true })
  
  const logPath = path.join(config.artifactDir, 'run.log')
  const logStream = fs.createWriteStream(logPath, { flags: 'w' })
  
  function log(_message: string): void {
    // info logging disabled; keep errors only via console.error paths
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
    const settings = getSettingsManager().getSettings()
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
    
    // Write report.json
    fs.writeFileSync(result.reportPath, JSON.stringify(result, null, 2), 'utf-8')
    
    logStream.end()
    return result
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Pipeline failed: ${errorMessage}`)
    logStream.end()
    throw error
  }
}

export function generateArtifactDir(baseDir: string = 'artifacts'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
  return path.join(baseDir, `run-${timestamp}`)
}

// =============================================================================
// HTTP BRIDGE (Using Electron Session)
// =============================================================================

export function registerHttpBridge() {
  // Handle network:request from renderer
  ipcMain.handle('network:request', async (_evt, req: NetworkRequest): Promise<NetworkResponse> => {
    try {
      const method = req.method || 'GET'
      const headers = req.headers || {}
      
      // Get credentials if connectionId is provided
      let credentials: NtlmCredentials | undefined
      if (req.connectionId) {
        const creds = await getCredsStore().get(req.connectionId)
        if (creds) {
          credentials = creds
        }
      }
      
      const response = await makeNetworkRequest(req.url, method, headers, req.body, credentials)
      
      const ok = response.status >= 200 && response.status < 300
      
      if (!ok) {
        console.error(`[ERROR] Network request failed with status ${response.status}`)
        console.error(`[ERROR] Method: ${method}`)
        console.error(`[ERROR] URL: ${req.url}`)
        console.error(`[ERROR] Headers:`, JSON.stringify(response.headers, null, 2))
        console.error(`[ERROR] Response body:`, response.body)
      }
      
      return {
        ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        bodyText: response.body
      }
    } catch (error) {
      console.error(`[ERROR] Network request exception`)
      console.error(`[ERROR] Method: ${req.method || 'GET'}`)
      console.error(`[ERROR] URL: ${req.url}`)
      console.error(`[ERROR] Error details:`, error)
      return {
        ok: false,
        status: 0,
        statusText: String(error instanceof Error ? error.message : 'Network request failed'),
        headers: {},
        bodyText: ''
      }
    }
  })

  // Backward compatibility: Keep http:request handler for existing code
  ipcMain.handle('http:request', async (_evt, req: HttpReq): Promise<HttpRes> => {
    const auth = req.auth || { kind: 'none' }
    
    try {
      const method = req.method || 'GET'
      const headers = req.headers || {}
      
      // Get credentials based on auth type
      let credentials: NtlmCredentials | undefined
      if (auth.kind === 'ntlm' && auth.username && auth.password) {
        credentials = {
          domain: auth.domain || '',
          username: auth.username,
          password: auth.password
        }
      }
      
      const response = await makeNetworkRequest(req.url, method, headers, req.body, credentials)
      
      const ok = response.status >= 200 && response.status < 300
      
      if (!ok) {
        console.error(`[ERROR] HTTP request failed with status ${response.status}`)
        console.error(`[ERROR] Method: ${method}`)
        console.error(`[ERROR] URL: ${req.url}`)
        console.error(`[ERROR] Headers:`, JSON.stringify(response.headers, null, 2))
        console.error(`[ERROR] Response body:`, response.body)
      }
      
      return {
        ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        bodyText: response.body
      }
    } catch (error) {
      console.error(`[ERROR] HTTP request exception`)
      console.error(`[ERROR] Method: ${req.method || 'GET'}`)
      console.error(`[ERROR] URL: ${req.url}`)
      console.error(`[ERROR] Error details:`, error)
      return {
        ok: false,
        status: 0,
        statusText: String(error instanceof Error ? error.message : 'HTTP request failed'),
        headers: {},
        bodyText: ''
      }
    }
  })
}

// =============================================================================
// ELECTRON APP & IPC HANDLERS
// =============================================================================

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const devServer = process.env['VITE_DEV_SERVER_URL']
  if (devServer) {
    mainWindow.loadURL(devServer)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// =============================================================================
// AUTO-UPDATER
// =============================================================================

function setupAutoUpdater() {
  // Configure auto-updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // Log update events
  autoUpdater.on('checking-for-update', () => {
    console.log('[UPDATE] Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[UPDATE] Update available:', info.version)
    
    // Ask user if they want to download the update
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available. Would you like to download it now?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1
      }).then(result => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate()
        }
      })
    }
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[UPDATE] No updates available')
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[UPDATE] Download progress: ${Math.round(progress.percent)}%`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[UPDATE] Update downloaded:', info.version)
    
    // Ask user if they want to install and restart
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded. Restart the application to install the update?`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1
      }).then(result => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall(false, true)
        }
      })
    }
  })

  autoUpdater.on('error', (error) => {
    console.error('[UPDATE] Error:', error)
  })

  // Check for updates on startup (skip in development)
  if (!process.env['VITE_DEV_SERVER_URL']) {
    // Wait 3 seconds after app start to check for updates
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.error('[UPDATE] Failed to check for updates:', err)
      })
    }, 3000)
  }
}

app.whenReady().then(async () => {
  // Initialize settings manager first
  getSettingsManager()

  // Use in-memory creds store for testing
  if (process.env['NODE_ENV'] === 'test') {
    setCredsStore(new InMemoryCredsStore())
  }

  // Register default connection (always available)
  registerConnection('default')
  
  // Set system proxy
  await session.defaultSession.setProxy({ mode: 'system' })

  // Register HTTP bridge for network requests
  registerHttpBridge()
  
  // Setup IPC handlers
  setupIpcHandlers()
  
  createWindow()
  
  // Setup auto-updater after window is created
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Handle HTTP authentication challenges
app.on('login', async (event, webContents, request, authInfo, callback) => {
  event.preventDefault()
  
  // Try to get credentials from pending auth requests
  const url = request.url
  const credentials = pendingAuthRequests.get(url)
  
  if (credentials) {
    // Provide saved credentials for NTLM/Kerberos auth
    callback(credentials.username, credentials.password)
  } else {
    // No credentials available - let auth fail
    callback('', '')
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function setupIpcHandlers() {
  const credsStore = getCredsStore()

  // Connection management
  ipcMain.handle('connections:list', async () => {
    // Get all registered connections
    const allConnections = listConnections()
    
    // Check which ones have stored credentials
    const connectionsWithStatus = await Promise.all(
      allConnections.map(async (name) => ({
        name,
        hasCreds: await credsStore.has(name)
      }))
    )
    
    return connectionsWithStatus
  })

  ipcMain.handle('connections:save', async (_event, args: { name: string; apiUrl: string; domain?: string; username?: string; password?: string }) => {
    
    // Only save credentials if all three are provided
    if (args.domain && args.username && args.password) {
      const creds: NtlmCredentials = {
        domain: args.domain,
        username: args.username,
        password: args.password
      }
      await credsStore.save(args.name, creds)
    }
    // If credentials not provided, will use Windows integrated auth
  })

  ipcMain.handle('connections:delete', async (_event, name: string) => {
    // Unregister the connection
    unregisterConnection(name)
    
    // Delete credentials if they exist
    await credsStore.del(name)
  })

  ipcMain.handle('connections:test', async (_event, args: { name: string; url: string }) => {
    // Stub implementation
    return { ok: true }
  })

  ipcMain.handle('connections:get', async (_event, name: string) => {
    return await credsStore.get(name)
  })

  // Auth preflight and credential provision
  ipcMain.handle('auth:preflight', async (_event, req: AuthPreflightRequest): Promise<AuthPreflightResponse> => {
    const startTime = Date.now()
    
    try {
      // Check if credentials exist for this connection
      const credentials = await credsStore.get(req.connectionId)
      
      // Try to make a simple HEAD request to the base URL
      const headers: Record<string, string> = {
        'Accept': 'text/html,application/json,*/*',
        'Cache-Control': 'no-cache'
      }
      
      try {
        const response = await makeNetworkRequest(req.baseUrl, 'GET', headers, undefined, credentials || undefined)
        const latencyMs = Date.now() - startTime
        
        if (response.status >= 200 && response.status < 400) {
          console.log(`[INFO] Preflight success for ${req.connectionId} (${latencyMs}ms)`)
          return { mode: 'silent-ok', details: `Connected in ${latencyMs}ms` }
        } else if (response.status === 401 || response.status === 403) {
          console.log(`[INFO] Preflight auth required for ${req.connectionId} (status ${response.status})`)
          return { mode: 'auth-required', details: 'Authentication required' }
        } else {
          console.log(`[WARN] Preflight unexpected status ${response.status} for ${req.connectionId}`)
          return { mode: 'unreachable', details: `Server returned ${response.status}` }
        }
      } catch (networkError) {
        const errorMessage = networkError instanceof Error ? networkError.message : String(networkError)
        console.log(`[ERROR] Preflight network error for ${req.connectionId}: ${errorMessage}`)
        
        // Distinguish between different error types
        if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
          return { mode: 'needs-vpn', details: 'Unable to resolve hostname (VPN required?)' }
        } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT')) {
          return { mode: 'unreachable', details: 'Connection refused or timed out' }
        } else if (errorMessage.includes('ERR_UNEXPECTED') || errorMessage.includes('ERR_FAILED') || errorMessage.includes('ERR_ABORTED')) {
          // NTLM/auth negotiation failures - likely means Windows integrated auth failed
          console.log(`[INFO] Auth negotiation error detected, prompting for credentials`)
          return { mode: 'auth-required', details: 'Windows authentication failed - manual credentials required' }
        } else {
          return { mode: 'unreachable', details: errorMessage }
        }
      }
    } catch (error) {
      console.error(`[ERROR] Preflight failed for ${req.connectionId}:`, error)
      return { mode: 'unreachable', details: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('auth:provideCredentials', async (_event, req: AuthProvideCredentialsRequest): Promise<AuthProvideCredentialsResponse> => {
    try {
      // Save the credentials
      const creds: NtlmCredentials = {
        domain: req.domain,
        username: req.username,
        password: req.password
      }
      await credsStore.save(req.connectionId, creds)
      
      // Test the credentials immediately
      const headers: Record<string, string> = {
        'Accept': 'text/html,application/json,*/*',
        'Cache-Control': 'no-cache'
      }
      
      try {
        const response = await makeNetworkRequest(req.baseUrl, 'GET', headers, undefined, creds)
        
        if (response.status >= 200 && response.status < 400) {
          console.log(`[INFO] Credentials validated successfully for ${req.connectionId}`)
          return { ok: true }
        } else if (response.status === 401 || response.status === 403) {
          console.log(`[WARN] Credentials rejected for ${req.connectionId} (status ${response.status})`)
          return { ok: false, error: 'Invalid credentials - authentication failed' }
        } else {
          console.log(`[WARN] Unexpected status ${response.status} when validating credentials for ${req.connectionId}`)
          return { ok: false, error: `Server returned ${response.status}` }
        }
      } catch (networkError) {
        const errorMessage = networkError instanceof Error ? networkError.message : String(networkError)
        console.error(`[ERROR] Network error validating credentials for ${req.connectionId}:`, errorMessage)
        return { ok: false, error: `Network error: ${errorMessage}` }
      }
    } catch (error) {
      console.error(`[ERROR] Failed to provide credentials for ${req.connectionId}:`, error)
      return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // File operations
  ipcMain.handle('files:selectFile', async (_event, accept?: string) => {
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

  ipcMain.handle('files:readFileBinary', async (_event, filePath: string) => {
    const fsPromises = await import('fs/promises')
    try {
      const buffer = await fsPromises.readFile(filePath)
      return buffer.toString('base64')
    } catch (error) {
      throw new Error(`Failed to read binary file: ${(error as Error).message}`)
    }
  })

  ipcMain.handle('files:previewFile', async (_event, filePath: string) => {
    const ext = filePath.toLowerCase().split('.').pop()
    
    if (ext === 'xlsx' || ext === 'xls') {
      return parseXlsx(filePath)
    } else if (ext === 'csv') {
      return parseCsv(filePath)
    } else {
      throw new Error(`Unsupported file type: ${ext}`)
    }
  })

  // Workflow
  ipcMain.handle('workflow:run', async (_event, request: { inputPath: string; connectionName: string; apiUrl: string }) => {
    try {
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
      const credentials = await credsStore.get(request.connectionName)
      const metadata = await fetchAllMetadata(idguids, request.apiUrl, credentials || undefined)
      
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
        metadata
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
      console.error('[ERROR] Workflow failed')
      console.error('[ERROR] Error details:', error)
      return {
        ok: false,
        artifactDir: '',
        reportPath: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // System
  ipcMain.handle('system:openPath', async (_event, pathToOpen: string) => {
    const { shell } = await import('electron')
    await shell.openPath(pathToOpen)
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())

  // Settings
  ipcMain.handle('settings:get', async () => {
    return getSettingsManager().getSettings()
  })

  ipcMain.handle('settings:update', async (_event, updates: Partial<AppSettings>) => {
    getSettingsManager().updateSettings(updates)
  })

  ipcMain.handle('settings:reset', async () => {
    getSettingsManager().resetSettings()
  })
}
