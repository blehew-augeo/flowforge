// File parsers for CSV and XLSX files

import * as fs from 'fs'
import * as XLSX from 'xlsx'
import type { FilePreview } from '../types'

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

