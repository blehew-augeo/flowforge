import type { DataRow, UserMetadataFull } from './types'

// =============================================================================
// TRANSFORMATION RULES
// =============================================================================

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

export function extractNameParts(email: string): Set<string> {
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

export function checkEmailMatchesMetadata(orderEmail: string, primaryEmailOrList: string | string[] | undefined): boolean {
  if (!orderEmail || !primaryEmailOrList) return false
  const normalizedOrder = normalizeEmail(orderEmail)
  if (Array.isArray(primaryEmailOrList)) {
    return primaryEmailOrList.some(e => e && normalizeEmail(e) === normalizedOrder)
  }
  return normalizeEmail(primaryEmailOrList) === normalizedOrder
}

export function checkEmailContainsName(orderEmail: string, firstName?: string, lastName?: string): boolean {
  if (!orderEmail) {
    return false
  }
  
  const emailParts = extractNameParts(orderEmail)
  
  // Helper function to check if any name part is found in email
  const checkNameParts = (name: string): boolean => {
    const nameLower = name.toLowerCase().trim()
    
    // First try exact match or substring match
    if (emailParts.has(nameLower) || Array.from(emailParts).some(part => part.includes(nameLower))) {
      return true
    }
    
    // If name contains spaces, split and check each part individually
    if (nameLower.includes(' ')) {
      const nameParts = nameLower.split(/\s+/).filter(p => p.length > 0)
      for (const namePart of nameParts) {
        if (emailParts.has(namePart) || Array.from(emailParts).some(part => part.includes(namePart))) {
          return true
        }
      }
    }
    
    return false
  }
  
  if (firstName && checkNameParts(firstName)) {
    return true
  }
  
  if (lastName && checkNameParts(lastName)) {
    return true
  }
  
  return false
}

export function checkCompanyDomain(orderEmail: string, domainKeywords: string[]): boolean {
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

export function checkSocialGood(productType: string): boolean {
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


