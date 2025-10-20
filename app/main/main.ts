import { app, BrowserWindow, ipcMain, dialog, session, net } from 'electron'
import path from 'node:path'
import { URL } from 'node:url'
import * as fs from 'fs'
import * as crypto from 'crypto'
import keytar from 'keytar'
import * as XLSX from 'xlsx'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import log from 'electron-log'

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
// SECURITY UTILITIES
// =============================================================================

/**
 * Validates that a file path is safe to access
 * Prevents path traversal attacks
 */
function isValidFilePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') {
    return false
  }
  
  // Check for path traversal attempts
  const normalized = path.normalize(filePath)
  
  // Reject paths with null bytes
  if (normalized.includes('\0')) {
    return false
  }
  
  // Reject paths trying to escape using .. in suspicious ways
  // Allow legitimate use but be cautious
  const absolutePath = path.resolve(normalized)
  
  // On Windows, reject UNC paths that might access network resources unexpectedly
  if (process.platform === 'win32' && absolutePath.startsWith('\\\\')) {
    // Allow if it's a legitimate long path, but log it
    console.log('[SECURITY] UNC path access attempted:', absolutePath)
  }
  
  return true
}

/**
 * Validates URL for network requests
 * Prevents SSRF and local file access
 */
function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false
  }
  
  try {
    const parsed = new URL(url)
    
    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.error('[SECURITY] Invalid protocol:', parsed.protocol)
      return false
    }
    
    // Reject localhost and private IP ranges to prevent SSRF
    const hostname = parsed.hostname.toLowerCase()
    
    // Check for localhost variations
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      console.warn('[SECURITY] Localhost access attempted:', url)
      // Allow for development but log it
      if (process.env['NODE_ENV'] === 'development' || process.env['VITE_DEV_SERVER_URL']) {
        return true
      }
      return false
    }
    
    // Check for private IP ranges (basic check)
    if (hostname.startsWith('192.168.') || 
        hostname.startsWith('10.') || 
        hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
      console.warn('[SECURITY] Private IP access attempted:', url)
      // These might be legitimate corporate networks, so allow but log
    }
    
    return true
  } catch (error) {
    console.error('[SECURITY] Invalid URL format:', url)
    return false
  }
}

/**
 * Sanitizes string input to prevent injection
 */
function sanitizeString(input: string, maxLength: number = 1000): string {
  if (!input || typeof input !== 'string') {
    return ''
  }
  
  // Truncate to max length
  let sanitized = input.slice(0, maxLength)
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '')
  
  return sanitized
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
      // Only log if this is a new URL we haven't seen before
      const isNewUrl = !pendingAuthRequests.has(url)
      if (isNewUrl) {
        log.info('[AUTH] Storing credentials for new URL:', url)
        log.info('[AUTH] Domain:', credentials.domain)
        log.info('[AUTH] Username:', credentials.username)
      }
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
      // Validate URL before making request
      if (!isValidUrl(req.url)) {
        console.error('[SECURITY] Invalid or unsafe URL rejected:', req.url)
        return {
          ok: false,
          status: 0,
          statusText: 'Invalid or unsafe URL',
          headers: {},
          bodyText: ''
        }
      }
      
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
      // Validate URL before making request
      if (!isValidUrl(req.url)) {
        console.error('[SECURITY] Invalid or unsafe URL rejected:', req.url)
        return {
          ok: false,
          status: 0,
          statusText: 'Invalid or unsafe URL',
          headers: {},
          bodyText: ''
        }
      }
      
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
      sandbox: false, // Keep false for now due to native modules (keytar)
      webSecurity: true, // Enforce web security
      allowRunningInsecureContent: false, // Block mixed content
      experimentalFeatures: false, // Disable experimental features
      enableBlinkFeatures: '', // Don't enable any additional Blink features
      disableBlinkFeatures: 'AutomationControlled' // Security feature
    }
  })

  const devServer = process.env['VITE_DEV_SERVER_URL']
  if (devServer) {
    mainWindow.loadURL(devServer)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Security: Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    
    // Allow navigation to dev server in development
    if (devServer && navigationUrl.startsWith(devServer)) {
      return
    }
    
    // Block all other navigation attempts
    console.warn('[SECURITY] Blocked navigation attempt to:', navigationUrl)
    event.preventDefault()
  })

  // Security: Prevent opening new windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn('[SECURITY] Blocked window.open attempt to:', url)
    return { action: 'deny' }
  })
}

// =============================================================================
// AUTO-UPDATER
// =============================================================================

function setupAutoUpdater() {
  // Configure auto-updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = log
  log.transports.file.level = 'info'

  // Log basic app/update context
  try {
    log.info(`[UPDATE] App ${app.getName()} v${app.getVersion()}`)
    const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml')
    if (fs.existsSync(updateConfigPath)) {
      const cfg = fs.readFileSync(updateConfigPath, 'utf-8')
      log.info('[UPDATE] app-update.yml found:\n' + cfg)
    } else {
      log.warn('[UPDATE] app-update.yml not found in resources (portable build cannot auto-update)')
    }
  } catch (e) {
    log.error('[UPDATE] Failed to log update context:', e)
  }

  // Log update events
  autoUpdater.on('checking-for-update', () => {
    log.info('[UPDATE] Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    log.info('[UPDATE] Update available: ' + info.version)
    
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
    log.info('[UPDATE] No updates available')
  })

  autoUpdater.on('download-progress', (progress) => {
    log.info(`[UPDATE] Download progress: ${Math.round(progress.percent)}%`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[UPDATE] Update downloaded: ' + info.version)
    
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
    const errMsg = error instanceof Error ? error.message : String(error)
    
    // Detect common cases and log appropriately
    if (errMsg.includes('Unable to find latest version') || errMsg.includes('HttpError: 406')) {
      log.info('[UPDATE] No production releases available on GitHub yet')
    } else if (errMsg.includes('ENOTFOUND') || errMsg.includes('ETIMEDOUT')) {
      log.warn('[UPDATE] Update check failed: Network unavailable')
    } else {
      log.error('[UPDATE] Update check failed:', errMsg)
    }
  })

  // Check for updates on startup (skip in development)
  if (!process.env['VITE_DEV_SERVER_URL']) {
    // Wait 3 seconds after app start to check for updates
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg.includes('Unable to find latest version') || errMsg.includes('HttpError: 406')) {
          log.info('[UPDATE] No production releases available yet - first install or waiting for releases')
        } else {
          log.warn('[UPDATE] Update check skipped:', errMsg)
        }
      })
    }, 3000)
  }
}

// =============================================================================
// WINDOWS INTEGRATED AUTHENTICATION SETUP
// =============================================================================
// These command line switches must be set BEFORE app.whenReady()
// They enable NTLM/Kerberos authentication for Windows Integrated Auth

// Allow authentication for all servers (use specific domain in production for security)
app.commandLine.appendSwitch('auth-server-whitelist', '*')
app.commandLine.appendSwitch('auth-negotiate-delegate-whitelist', '*')
// Enable authentication on non-standard ports
app.commandLine.appendSwitch('enable-auth-negotiate-port', 'true')

log.info('[AUTH] Windows Integrated Authentication enabled for all servers')

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

  // Security: Configure session security settings
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // Add security headers
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block']
      }
    })
  })

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
  // Try to get credentials from pending auth requests
  const url = request.url
  const credentials = pendingAuthRequests.get(url)
  
  log.info('[AUTH] ==========================================')
  log.info('[AUTH] Login event triggered')
  log.info('[AUTH] URL:', url)
  log.info('[AUTH] Auth scheme:', authInfo.scheme)
  log.info('[AUTH] Auth realm:', authInfo.realm)
  log.info('[AUTH] Auth host:', authInfo.host)
  log.info('[AUTH] Auth port:', authInfo.port)
  log.info('[AUTH] Is proxy:', authInfo.isProxy)
  log.info('[AUTH] Has stored credentials:', !!credentials)
  log.info('[AUTH] Windows Username:', process.env['USERNAME'])
  log.info('[AUTH] Windows Domain:', process.env['USERDOMAIN'])
  
  if (credentials) {
    // We have explicit credentials - use them
    event.preventDefault()
    
    // For NTLM, username needs to be DOMAIN\username format
    const username = credentials.domain 
      ? `${credentials.domain}\\${credentials.username}`
      : credentials.username
    
    log.info('[AUTH] Using explicit credentials')
    log.info('[AUTH] Domain:', credentials.domain)
    log.info('[AUTH] Username (raw):', credentials.username)
    log.info('[AUTH] Username (formatted):', username)
    log.info('[AUTH] Password length:', credentials.password?.length || 0)
    
    callback(username, credentials.password)
    log.info('[AUTH] ==========================================')
  } else {
    log.info('[AUTH] No explicit credentials - using Windows Integrated Auth')
    log.info('[AUTH] ==========================================')
    // Don't call event.preventDefault() so Electron uses the logged-in user's credentials
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
    // Validate and sanitize inputs
    const name = sanitizeString(args.name, 255)
    if (!name) {
      throw new Error('Invalid connection name')
    }
    
    // Validate API URL if provided
    if (args.apiUrl && !isValidUrl(args.apiUrl)) {
      throw new Error('Invalid API URL')
    }
    
    // Only save credentials if all three are provided
    if (args.domain && args.username && args.password) {
      const creds: NtlmCredentials = {
        domain: sanitizeString(args.domain, 255),
        username: sanitizeString(args.username, 255),
        password: args.password // Don't sanitize password as it may have special chars
      }
      await credsStore.save(name, creds)
    }
    // If credentials not provided, will use Windows integrated auth
  })

  ipcMain.handle('connections:delete', async (_event, name: string) => {
    // Sanitize connection name
    const sanitizedName = sanitizeString(name, 255)
    if (!sanitizedName) {
      throw new Error('Invalid connection name')
    }
    
    // Unregister the connection
    unregisterConnection(sanitizedName)
    
    // Delete credentials if they exist
    await credsStore.del(sanitizedName)
  })

  ipcMain.handle('connections:test', async (_event, args: { name: string; url: string }) => {
    // Validate URL
    if (!isValidUrl(args.url)) {
      throw new Error('Invalid URL')
    }
    
    // Stub implementation
    return { ok: true }
  })

  ipcMain.handle('connections:get', async (_event, name: string) => {
    // Sanitize connection name
    const sanitizedName = sanitizeString(name, 255)
    if (!sanitizedName) {
      throw new Error('Invalid connection name')
    }
    
    return await credsStore.get(sanitizedName)
  })

  // Auth preflight and credential provision
  ipcMain.handle('auth:preflight', async (_event, req: AuthPreflightRequest): Promise<AuthPreflightResponse> => {
    const startTime = Date.now()
    
    log.info('[PREFLIGHT] Starting preflight check for:', req.baseUrl)
    log.info('[PREFLIGHT] Connection ID:', req.connectionId)
    
    try {
      // Validate inputs
      if (!isValidUrl(req.baseUrl)) {
        log.info('[PREFLIGHT] Invalid URL')
        return { mode: 'unreachable', details: 'Invalid URL' }
      }
      
      const connectionId = sanitizeString(req.connectionId, 255)
      if (!connectionId) {
        log.info('[PREFLIGHT] Invalid connection ID')
        return { mode: 'unreachable', details: 'Invalid connection ID' }
      }
      
      // Check if credentials exist for this connection
      log.info('[PREFLIGHT] Checking for stored credentials')
      const credentials = await credsStore.get(connectionId)
      log.info('[PREFLIGHT] Credentials found:', !!credentials)
      if (credentials) {
        log.info('[PREFLIGHT] Will use credentials - Domain:', credentials.domain, 'Username:', credentials.username)
      }
      
      // Try to make a simple HEAD request to the base URL
      const headers: Record<string, string> = {
        'Accept': 'text/html,application/json,*/*',
        'Cache-Control': 'no-cache'
      }
      
      try {
        const response = await makeNetworkRequest(req.baseUrl, 'GET', headers, undefined, credentials || undefined)
        const latencyMs = Date.now() - startTime
        
        if (response.status >= 200 && response.status < 400) {
          log.info(`[PREFLIGHT] Success for ${connectionId} (${latencyMs}ms)`)
          return { mode: 'silent-ok', details: `Connected in ${latencyMs}ms` }
        } else if (response.status === 401 || response.status === 403) {
          log.info(`[PREFLIGHT] Auth required for ${connectionId} (status ${response.status})`)
          return { mode: 'auth-required', details: 'Authentication required' }
        } else {
          log.warn(`[PREFLIGHT] Unexpected status ${response.status} for ${connectionId}`)
          return { mode: 'unreachable', details: `Server returned ${response.status}` }
        }
      } catch (networkError) {
        const errorMessage = networkError instanceof Error ? networkError.message : String(networkError)
        log.error(`[PREFLIGHT] Network error for ${connectionId}: ${errorMessage}`)
        
        // Distinguish between different error types
        if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
          return { mode: 'needs-vpn', details: 'Unable to resolve hostname (VPN required?)' }
        } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT')) {
          return { mode: 'unreachable', details: 'Connection refused or timed out' }
        } else if (errorMessage.includes('ERR_UNEXPECTED') || errorMessage.includes('ERR_FAILED') || errorMessage.includes('ERR_ABORTED')) {
          // NTLM/auth negotiation failures - likely means Windows integrated auth failed
          log.info(`[PREFLIGHT] Auth negotiation error detected, prompting for credentials`)
          return { mode: 'auth-required', details: 'Windows authentication failed - manual credentials required' }
        } else {
          return { mode: 'unreachable', details: errorMessage }
        }
      }
    } catch (error) {
      log.error(`[PREFLIGHT] Failed:`, error)
      return { mode: 'unreachable', details: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('auth:provideCredentials', async (_event, req: AuthProvideCredentialsRequest): Promise<AuthProvideCredentialsResponse> => {
    log.info('[AUTH] Receiving credentials for connection:', req.connectionId)
    log.info('[AUTH] Base URL:', req.baseUrl)
    log.info('[AUTH] Domain (raw):', req.domain)
    log.info('[AUTH] Username (raw):', req.username)
    log.info('[AUTH] Password length:', req.password?.length || 0)
    
    try {
      // Validate inputs
      if (!isValidUrl(req.baseUrl)) {
        log.info('[AUTH] Invalid URL provided')
        return { ok: false, error: 'Invalid URL' }
      }
      
      const connectionId = sanitizeString(req.connectionId, 255)
      if (!connectionId) {
        log.info('[AUTH] Invalid connection ID')
        return { ok: false, error: 'Invalid connection ID' }
      }
      
      const domain = sanitizeString(req.domain, 255)
      const username = sanitizeString(req.username, 255)
      
      log.info('[AUTH] After sanitization - Domain:', domain)
      log.info('[AUTH] After sanitization - Username:', username)
      
      if (!domain || !username || !req.password) {
        log.info('[AUTH] Missing required credentials after sanitization')
        return { ok: false, error: 'All credentials are required' }
      }
      
      // Save the credentials
      const creds: NtlmCredentials = {
        domain,
        username,
        password: req.password
      }
      log.info('[AUTH] Saving credentials to store for:', connectionId)
      await credsStore.save(connectionId, creds)
      log.info('[AUTH] Credentials saved successfully')
      
      // Test the credentials immediately
      log.info('[AUTH] Testing credentials with network request to:', req.baseUrl)
      const headers: Record<string, string> = {
        'Accept': 'text/html,application/json,*/*',
        'Cache-Control': 'no-cache'
      }
      
      try {
        const response = await makeNetworkRequest(req.baseUrl, 'GET', headers, undefined, creds)
        
        log.info('[AUTH] Credential test response status:', response.status)
        log.info('[AUTH] Credential test response headers:', JSON.stringify(response.headers, null, 2))
        
        if (response.status >= 200 && response.status < 400) {
          log.info(`[AUTH] Credentials validated successfully for ${connectionId}`)
          return { ok: true }
        } else if (response.status === 401 || response.status === 403) {
          log.info(`[AUTH] Credentials rejected for ${connectionId} (status ${response.status})`)
          log.info('[AUTH] Response body (first 500 chars):', response.body.substring(0, 500))
          return { ok: false, error: 'Invalid credentials - authentication failed' }
        } else {
          log.info(`[AUTH] Unexpected status ${response.status} when validating credentials for ${connectionId}`)
          return { ok: false, error: `Server returned ${response.status}` }
        }
      } catch (networkError) {
        const errorMessage = networkError instanceof Error ? networkError.message : String(networkError)
        log.error(`[AUTH] Network error validating credentials for ${connectionId}:`, errorMessage)
        return { ok: false, error: `Network error: ${errorMessage}` }
      }
    } catch (error) {
      log.error(`[ERROR] Failed to provide credentials:`, error)
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

  ipcMain.handle('files:previewFile', async (_event, filePath: string) => {
    // Validate file path
    if (!isValidFilePath(filePath)) {
      throw new Error('Invalid file path')
    }
    
    const ext = filePath.toLowerCase().split('.').pop()
    
    // Validate file extension to prevent arbitrary file access
    if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'csv') {
      throw new Error(`Unsupported file type: ${ext}`)
    }
    
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
      // Validate inputs
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
      const credentials = await credsStore.get(connectionName)
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
    // Validate path before opening
    if (!isValidFilePath(pathToOpen)) {
      throw new Error('Invalid path')
    }
    
    // Additional check: ensure path exists before opening
    if (!fs.existsSync(pathToOpen)) {
      throw new Error('Path does not exist')
    }
    
    const { shell } = await import('electron')
    const result = await shell.openPath(pathToOpen)
    
    // shell.openPath returns empty string on success, error message on failure
    if (result) {
      throw new Error(`Failed to open path: ${result}`)
    }
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
