// Network request handlers

import { ipcMain } from 'electron'
import log from 'electron-log'
import type { IpcContext } from './types'
import type { NetworkRequest, NetworkResponse, HttpReq, HttpRes } from '../types'
import { isValidUrl } from '../utils/security'
import { makeNetworkRequest } from '../network'

/**
 * Register network-related IPC handlers
 */
export function registerNetworkHandlers(ctx: IpcContext): void {
  // Modern network request handler
  ipcMain.handle('network:request', async (_evt, req: NetworkRequest): Promise<NetworkResponse> => {
    try {
      // Validate inputs
      if (!req || typeof req !== 'object') {
        return {
          ok: false,
          status: 0,
          statusText: 'Invalid request object',
          headers: {},
          bodyText: ''
        }
      }

      if (!req.url || typeof req.url !== 'string') {
        return {
          ok: false,
          status: 0,
          statusText: 'URL is required',
          headers: {},
          bodyText: ''
        }
      }

      // Validate URL before making request
      if (!isValidUrl(req.url)) {
        log.error('[SECURITY] Invalid or unsafe URL rejected:', req.url)
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
      let credentials
      if (req.connectionId) {
        credentials = await ctx.credsStore.get(req.connectionId)
      }
      
      const response = await makeNetworkRequest(req.url, method, headers, req.body, credentials)
      
      const ok = response.status >= 200 && response.status < 300
      
      if (!ok) {
        log.error(`[ERROR] Network request failed with status ${response.status}`)
        log.error(`[ERROR] Method: ${method}`)
        log.error(`[ERROR] URL: ${req.url}`)
        log.error(`[ERROR] Headers:`, JSON.stringify(response.headers, null, 2))
        log.error(`[ERROR] Response body:`, response.body)
      }
      
      return {
        ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        bodyText: response.body
      }
    } catch (error) {
      log.error(`[ERROR] Network request exception`)
      log.error(`[ERROR] Method: ${req.method || 'GET'}`)
      log.error(`[ERROR] URL: ${req.url}`)
      log.error(`[ERROR] Error details:`, error)
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
    try {
      // Validate inputs
      if (!req || typeof req !== 'object') {
        return {
          ok: false,
          status: 0,
          statusText: 'Invalid request object',
          headers: {},
          bodyText: ''
        }
      }

      if (!req.url || typeof req.url !== 'string') {
        return {
          ok: false,
          status: 0,
          statusText: 'URL is required',
          headers: {},
          bodyText: ''
        }
      }

      const auth = req.auth || { kind: 'none' }
      
      // Validate URL before making request
      if (!isValidUrl(req.url)) {
        log.error('[SECURITY] Invalid or unsafe URL rejected:', req.url)
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
      let credentials
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
        log.error(`[ERROR] HTTP request failed with status ${response.status}`)
        log.error(`[ERROR] Method: ${method}`)
        log.error(`[ERROR] URL: ${req.url}`)
        log.error(`[ERROR] Headers:`, JSON.stringify(response.headers, null, 2))
        log.error(`[ERROR] Response body:`, response.body)
      }
      
      return {
        ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        bodyText: response.body
      }
    } catch (error) {
      log.error(`[ERROR] HTTP request exception`)
      log.error(`[ERROR] Method: ${req.method || 'GET'}`)
      log.error(`[ERROR] URL: ${req.url}`)
      log.error(`[ERROR] Error details:`, error)
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

