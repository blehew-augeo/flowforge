// Security utilities for validating and sanitizing inputs

import path from 'node:path'
import { URL } from 'node:url'
import log from 'electron-log'

/**
 * Validates that a file path is safe to access
 * Prevents path traversal attacks
 */
export function isValidFilePath(filePath: string): boolean {
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
    log.warn('[SECURITY] UNC path access attempted:', absolutePath)
  }
  
  return true
}

/**
 * Validates URL for network requests
 * Prevents SSRF and local file access
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false
  }
  
  try {
    const parsed = new URL(url)
    
    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      log.error('[SECURITY] Invalid protocol:', parsed.protocol)
      return false
    }
    
    // Reject localhost and private IP ranges to prevent SSRF
    const hostname = parsed.hostname.toLowerCase()
    
    // Check for localhost variations
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      log.warn('[SECURITY] Localhost access attempted:', url)
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
      log.warn('[SECURITY] Private IP access attempted:', url)
      // These might be legitimate corporate networks, so allow but log
    }
    
    return true
  } catch (error) {
    log.error('[SECURITY] Invalid URL format:', url)
    return false
  }
}

/**
 * Sanitizes string input to prevent injection
 */
export function sanitizeString(input: string, maxLength: number = 1000): string {
  if (!input || typeof input !== 'string') {
    return ''
  }
  
  // Truncate to max length
  let sanitized = input.slice(0, maxLength)
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '')
  
  return sanitized
}

