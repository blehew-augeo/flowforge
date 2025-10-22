// File writers for CSV and XLSX

import * as fs from 'fs'
import * as XLSX from 'xlsx'
import type { DataRow } from '../types'

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

/**
 * Write data to CSV file
 */
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

/**
 * Write data to XLSX file
 */
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

