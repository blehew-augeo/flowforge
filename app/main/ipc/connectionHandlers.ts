// Connection and authentication handlers

import { ipcMain } from 'electron'
import log from 'electron-log'
import type { IpcContext } from './types'
import type { 
  NtlmCredentials, 
  AuthPreflightRequest, 
  AuthPreflightResponse,
  AuthProvideCredentialsRequest,
  AuthProvideCredentialsResponse
} from '../types'
import { isValidUrl, sanitizeString } from '../utils/security'
import { makeNetworkRequest } from '../network'
import { listConnections, registerConnection, unregisterConnection } from '../connectionRegistry'

/**
 * Register connection and authentication IPC handlers
 */
export function registerConnectionHandlers(ctx: IpcContext): void {
  // List all registered connections
  ipcMain.handle('connections:list', async () => {
    const allConnections = listConnections()
    
    // Check which ones have stored credentials
    const connectionsWithStatus = await Promise.all(
      allConnections.map(async (name) => ({
        name,
        hasCreds: await ctx.credsStore.has(name)
      }))
    )
    
    return connectionsWithStatus
  })

  // Save a connection with optional credentials
  ipcMain.handle('connections:save', async (_event, args: { 
    name: string
    apiUrl: string
    domain?: string
    username?: string
    password?: string 
  }) => {
    // Validate and sanitize inputs
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments')
    }

    const name = sanitizeString(args.name, 255)
    if (!name) {
      throw new Error('Invalid connection name')
    }
    
    // Validate API URL if provided
    if (args.apiUrl && !isValidUrl(args.apiUrl)) {
      throw new Error('Invalid API URL')
    }
    
    // Register the connection
    registerConnection(name)
    
    // Only save credentials if all three are provided
    if (args.domain && args.username && args.password) {
      const creds: NtlmCredentials = {
        domain: sanitizeString(args.domain, 255),
        username: sanitizeString(args.username, 255),
        password: args.password // Don't sanitize password as it may have special chars
      }
      await ctx.credsStore.save(name, creds)
    }
    // If credentials not provided, will use Windows integrated auth
  })

  // Delete a connection
  ipcMain.handle('connections:delete', async (_event, name: string) => {
    // Validate input
    if (!name || typeof name !== 'string') {
      throw new Error('Connection name is required')
    }

    // Sanitize connection name
    const sanitizedName = sanitizeString(name, 255)
    if (!sanitizedName) {
      throw new Error('Invalid connection name')
    }
    
    // Unregister the connection
    unregisterConnection(sanitizedName)
    
    // Delete credentials if they exist
    await ctx.credsStore.del(sanitizedName)
  })

  // Test a connection
  ipcMain.handle('connections:test', async (_event, args: { name: string; url: string }) => {
    // Validate inputs
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments')
    }

    if (!args.url || typeof args.url !== 'string') {
      throw new Error('URL is required')
    }

    // Validate URL
    if (!isValidUrl(args.url)) {
      throw new Error('Invalid URL')
    }
    
    // Stub implementation - could be expanded to actually test the connection
    return { ok: true }
  })

  // Get connection credentials
  ipcMain.handle('connections:get', async (_event, name: string) => {
    // Validate input
    if (!name || typeof name !== 'string') {
      throw new Error('Connection name is required')
    }

    // Sanitize connection name
    const sanitizedName = sanitizeString(name, 255)
    if (!sanitizedName) {
      throw new Error('Invalid connection name')
    }
    
    return await ctx.credsStore.get(sanitizedName)
  })

  // Auth preflight check
  ipcMain.handle('auth:preflight', async (_event, req: AuthPreflightRequest): Promise<AuthPreflightResponse> => {
    const startTime = Date.now()
    
    log.info('[PREFLIGHT] Starting preflight check for:', req.baseUrl)
    log.info('[PREFLIGHT] Connection ID:', req.connectionId)
    
    try {
      // Validate inputs
      if (!req || typeof req !== 'object') {
        log.info('[PREFLIGHT] Invalid request object')
        return { mode: 'unreachable', details: 'Invalid request' }
      }

      if (!req.baseUrl || typeof req.baseUrl !== 'string') {
        log.info('[PREFLIGHT] Missing base URL')
        return { mode: 'unreachable', details: 'Base URL is required' }
      }

      if (!isValidUrl(req.baseUrl)) {
        log.info('[PREFLIGHT] Invalid URL')
        return { mode: 'unreachable', details: 'Invalid URL' }
      }
      
      if (!req.connectionId || typeof req.connectionId !== 'string') {
        log.info('[PREFLIGHT] Missing connection ID')
        return { mode: 'unreachable', details: 'Connection ID is required' }
      }

      const connectionId = sanitizeString(req.connectionId, 255)
      if (!connectionId) {
        log.info('[PREFLIGHT] Invalid connection ID')
        return { mode: 'unreachable', details: 'Invalid connection ID' }
      }
      
      // Check if credentials exist for this connection
      log.info('[PREFLIGHT] Checking for stored credentials')
      const credentials = await ctx.credsStore.get(connectionId)
      log.info('[PREFLIGHT] Credentials found:', !!credentials)
      if (credentials) {
        log.info('[PREFLIGHT] Will use credentials - Domain:', credentials.domain, 'Username:', credentials.username)
      }
      
      // Try to make a simple GET request to the base URL
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

  // Provide credentials and validate them
  ipcMain.handle('auth:provideCredentials', async (_event, req: AuthProvideCredentialsRequest): Promise<AuthProvideCredentialsResponse> => {
    log.info('[AUTH] ==========================================')
    log.info('[AUTH] CREDENTIAL PROVISION REQUEST')
    log.info('[AUTH] Receiving credentials for connection:', req.connectionId)
    log.info('[AUTH] Base URL:', req.baseUrl)
    log.info('[AUTH] Domain (raw):', req.domain)
    log.info('[AUTH] Username (raw):', req.username)
    log.info('[AUTH] Password length:', req.password?.length || 0)
    log.info('[AUTH] Windows Username (for comparison):', process.env['USERNAME'])
    log.info('[AUTH] Windows Domain (for comparison):', process.env['USERDOMAIN'])
    
    try {
      // Validate inputs
      if (!req || typeof req !== 'object') {
        log.error('[AUTH] Invalid request object')
        return { ok: false, error: 'Invalid request' }
      }

      if (!req.baseUrl || typeof req.baseUrl !== 'string') {
        log.error('[AUTH] Missing base URL')
        return { ok: false, error: 'Base URL is required' }
      }

      if (!isValidUrl(req.baseUrl)) {
        log.error('[AUTH] Invalid URL provided')
        return { ok: false, error: 'Invalid URL' }
      }
      
      if (!req.connectionId || typeof req.connectionId !== 'string') {
        log.error('[AUTH] Missing connection ID')
        return { ok: false, error: 'Connection ID is required' }
      }

      const connectionId = sanitizeString(req.connectionId, 255)
      if (!connectionId) {
        log.error('[AUTH] Invalid connection ID')
        return { ok: false, error: 'Invalid connection ID' }
      }
      
      if (!req.domain || typeof req.domain !== 'string' || 
          !req.username || typeof req.username !== 'string' || 
          !req.password || typeof req.password !== 'string') {
        log.error('[AUTH] Missing required credentials')
        return { ok: false, error: 'Domain, username, and password are required' }
      }

      const domain = sanitizeString(req.domain, 255)
      const username = sanitizeString(req.username, 255)
      
      log.info('[AUTH] After sanitization - Domain:', domain)
      log.info('[AUTH] After sanitization - Username:', username)
      
      if (!domain || !username || !req.password) {
        log.error('[AUTH] Missing required credentials after sanitization')
        return { ok: false, error: 'All credentials are required' }
      }
      
      // Save the credentials
      const creds: NtlmCredentials = {
        domain,
        username,
        password: req.password
      }
      log.info('[AUTH] Saving credentials to store for:', connectionId)
      await ctx.credsStore.save(connectionId, creds)
      log.info('[AUTH] Credentials saved successfully')
      
      // Verify credentials were saved
      const savedCreds = await ctx.credsStore.get(connectionId)
      log.info('[AUTH] Verification - credentials retrieved from store:', !!savedCreds)
      if (savedCreds) {
        log.info('[AUTH] Verification - Domain matches:', savedCreds.domain === domain)
        log.info('[AUTH] Verification - Username matches:', savedCreds.username === username)
      }
      
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
          log.info(`[AUTH] ✓ Credentials validated successfully for ${connectionId}`)
          log.info('[AUTH] ==========================================')
          return { ok: true }
        } else if (response.status === 401 || response.status === 403) {
          log.error(`[AUTH] ✗ Credentials rejected for ${connectionId} (status ${response.status})`)
          log.error('[AUTH] Response body (first 500 chars):', response.body.substring(0, 500))
          log.info('[AUTH] ==========================================')
          return { ok: false, error: 'Invalid credentials - authentication failed' }
        } else {
          log.warn(`[AUTH] ? Unexpected status ${response.status} when validating credentials for ${connectionId}`)
          log.info('[AUTH] ==========================================')
          return { ok: false, error: `Server returned ${response.status}` }
        }
      } catch (networkError) {
        const errorMessage = networkError instanceof Error ? networkError.message : String(networkError)
        log.error(`[AUTH] ✗ Network error validating credentials for ${connectionId}:`, errorMessage)
        log.info('[AUTH] ==========================================')
        return { ok: false, error: `Network error: ${errorMessage}` }
      }
    } catch (error) {
      log.error(`[ERROR] Failed to provide credentials:`, error)
      log.info('[AUTH] ==========================================')
      return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })
}

