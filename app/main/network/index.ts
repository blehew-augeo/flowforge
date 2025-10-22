// Network layer using Electron's net API

import { net, session } from 'electron'
import log from 'electron-log'
import type { NtlmCredentials } from '../types'

// Global storage for pending auth requests
const pendingAuthRequests = new Map<string, NtlmCredentials>()

/**
 * Make HTTP request using Electron's net API
 */
export async function makeNetworkRequest(
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
      session: session.defaultSession,
      useSessionCookies: true
    })

    // Set headers
    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value)
    }

    // Store credentials using base URL as key (protocol + host)
    // This is important for proper auth handling
    let baseUrl = url
    try {
      const urlObj = new URL(url)
      baseUrl = `${urlObj.protocol}//${urlObj.host}`
    } catch {
      // If URL parsing fails, use full URL
    }

    if (credentials) {
      // Only log if this is a new base URL we haven't seen before
      const isNewUrl = !pendingAuthRequests.has(baseUrl)
      if (isNewUrl) {
        log.info('[AUTH] Storing credentials for base URL:', baseUrl)
        log.info('[AUTH] Domain:', credentials.domain)
        log.info('[AUTH] Username:', credentials.username)
      }
      pendingAuthRequests.set(baseUrl, credentials)
    }

    let responseData = ''
    let responseStatus = 0
    let responseStatusText = ''
    const responseHeaders: Record<string, string> = {}
    let authAttempted = false

    // CRITICAL: Per-request login handler for NTLM authentication
    // The global app.on('login') doesn't reliably fire for net.request()
    request.on('login', (authInfo, callback) => {
      log.info('[AUTH] ==========================================')
      log.info('[AUTH] Per-request login event triggered')
      log.info('[AUTH] URL:', url)
      log.info('[AUTH] Base URL:', baseUrl)
      log.info('[AUTH] Auth scheme:', authInfo.scheme)
      log.info('[AUTH] Auth realm:', authInfo.realm)
      log.info('[AUTH] Auth host:', authInfo.host)
      log.info('[AUTH] Auth port:', authInfo.port)
      log.info('[AUTH] Is proxy:', authInfo.isProxy)
      
      const creds = pendingAuthRequests.get(baseUrl)
      log.info('[AUTH] Has stored credentials for base URL:', !!creds)
      
      if (creds && !authAttempted) {
        authAttempted = true
        const username = creds.domain 
          ? `${creds.domain}\\${creds.username}`
          : creds.username
        
        log.info('[AUTH] Using explicit credentials from store')
        log.info('[AUTH] Domain:', creds.domain)
        log.info('[AUTH] Username (raw):', creds.username)
        log.info('[AUTH] Username (formatted):', username)
        log.info('[AUTH] Password length:', creds.password?.length || 0)
        log.info('[AUTH] ==========================================')
        
        callback(username, creds.password)
      } else {
        if (authAttempted) {
          log.info('[AUTH] Auth already attempted - avoiding retry loop')
        } else {
          log.info('[AUTH] No credentials found - trying Windows Integrated Auth')
        }
        log.info('[AUTH] ==========================================')
        callback()  // Try without explicit credentials (Windows integrated auth)
      }
    })

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
        // Log authentication result
        if (responseStatus === 401) {
          log.warn('[AUTH] Request to', url, 'returned 401 - authentication failed')
          log.warn('[AUTH] WWW-Authenticate header:', responseHeaders['www-authenticate'] || 'not present')
        } else if (responseStatus >= 200 && responseStatus < 300) {
          log.info('[AUTH] Request to', url, 'succeeded with status', responseStatus)
        }
        
        pendingAuthRequests.delete(baseUrl)
        resolve({
          status: responseStatus,
          statusText: responseStatusText,
          headers: responseHeaders,
          body: responseData
        })
      })
    })

    request.on('error', (error) => {
      log.error('[AUTH] Request error for', url, ':', error.message)
      pendingAuthRequests.delete(baseUrl)
      reject(error)
    })

    // Send body if present
    if (body && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT' || method.toUpperCase() === 'PATCH')) {
      request.write(body)
    }

    request.end()
  })
}

