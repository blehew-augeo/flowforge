import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DataRow, UserMetadataFull } from './types'

import {
  normalizeEmail,
  extractNameParts,
  checkEmailMatchesMetadata,
  checkEmailContainsName,
  checkCompanyDomain,
  checkSocialGood,
  applyTransformRules
} from './transformRules'

// =============================================================================
// UNIT TESTS
// =============================================================================

describe('normalizeEmail', () => {
  it('should convert email to lowercase', () => {
    expect(normalizeEmail('Test@Example.COM')).toBe('test@example.com')
  })

  it('should trim whitespace', () => {
    expect(normalizeEmail('  test@example.com  ')).toBe('test@example.com')
  })

  it('should handle empty string', () => {
    expect(normalizeEmail('')).toBe('')
  })

  it('should handle email with mixed case and spaces', () => {
    expect(normalizeEmail(' John.Doe@Company.COM ')).toBe('john.doe@company.com')
  })
})

describe('extractNameParts', () => {
  it('should extract parts separated by dots', () => {
    const parts = extractNameParts('john.doe@example.com')
    expect(parts.has('john')).toBe(true)
    expect(parts.has('doe')).toBe(true)
  })

  it('should extract parts separated by underscores', () => {
    const parts = extractNameParts('john_doe@example.com')
    expect(parts.has('john')).toBe(true)
    expect(parts.has('doe')).toBe(true)
  })

  it('should extract parts separated by hyphens', () => {
    const parts = extractNameParts('john-doe@example.com')
    expect(parts.has('john')).toBe(true)
    expect(parts.has('doe')).toBe(true)
  })

  it('should extract parts separated by plus signs', () => {
    const parts = extractNameParts('john+doe@example.com')
    expect(parts.has('john')).toBe(true)
    expect(parts.has('doe')).toBe(true)
  })

  it('should handle multiple separators', () => {
    const parts = extractNameParts('john.doe-smith_jr@example.com')
    expect(parts.has('john')).toBe(true)
    // The function splits by each separator independently
    // 'john.doe-smith_jr' split by '-' gives 'smith_jr', not 'smith'
    expect(parts.has('smith_jr')).toBe(true)
    expect(parts.has('jr')).toBe(true)
  })

  it('should return empty set for invalid email', () => {
    expect(extractNameParts('notanemail').size).toBe(0)
  })

  it('should return empty set for empty string', () => {
    expect(extractNameParts('').size).toBe(0)
  })

  it('should convert to lowercase', () => {
    const parts = extractNameParts('John.Doe@example.com')
    expect(parts.has('john')).toBe(true)
    expect(parts.has('doe')).toBe(true)
  })

  it('should skip empty parts', () => {
    const parts = extractNameParts('john..doe@example.com')
    // The function processes the string with each separator independently
    // So 'john..doe' gets split multiple times, creating overlapping results
    expect(parts.size).toBeGreaterThanOrEqual(2)
    expect(parts.has('')).toBe(false)
    expect(parts.has('john')).toBe(true)
    expect(parts.has('doe')).toBe(true)
  })
})

describe('checkEmailMatchesMetadata', () => {
  it('should match identical emails', () => {
    expect(checkEmailMatchesMetadata('test@example.com', 'test@example.com')).toBe(true)
  })

  it('should match emails case-insensitively', () => {
    expect(checkEmailMatchesMetadata('Test@Example.com', 'test@example.com')).toBe(true)
  })

  it('should match emails with whitespace differences', () => {
    expect(checkEmailMatchesMetadata(' test@example.com ', 'test@example.com')).toBe(true)
  })

  it('should match email in array', () => {
    const emailList = ['other@example.com', 'test@example.com', 'another@example.com']
    expect(checkEmailMatchesMetadata('test@example.com', emailList)).toBe(true)
  })

  it('should not match different emails', () => {
    expect(checkEmailMatchesMetadata('test@example.com', 'other@example.com')).toBe(false)
  })

  it('should not match when email not in array', () => {
    const emailList = ['other@example.com', 'another@example.com']
    expect(checkEmailMatchesMetadata('test@example.com', emailList)).toBe(false)
  })

  it('should return false for empty orderEmail', () => {
    expect(checkEmailMatchesMetadata('', 'test@example.com')).toBe(false)
  })

  it('should return false for undefined metadata email', () => {
    expect(checkEmailMatchesMetadata('test@example.com', undefined)).toBe(false)
  })

  it('should return false for empty array', () => {
    expect(checkEmailMatchesMetadata('test@example.com', [])).toBe(false)
  })

  it('should handle null values in array gracefully', () => {
    const emailList = ['other@example.com', '', 'test@example.com']
    expect(checkEmailMatchesMetadata('test@example.com', emailList)).toBe(true)
  })
})

describe('checkEmailContainsName', () => {
  it('should match email containing first name', () => {
    expect(checkEmailContainsName('john.smith@example.com', 'John')).toBe(true)
  })

  it('should match email containing last name', () => {
    expect(checkEmailContainsName('john.smith@example.com', undefined, 'Smith')).toBe(true)
  })

  it('should match email containing both names', () => {
    expect(checkEmailContainsName('john.smith@example.com', 'John', 'Smith')).toBe(true)
  })

  it('should match email containing first name as part of larger string', () => {
    expect(checkEmailContainsName('johnsmith@example.com', 'John')).toBe(true)
  })

  it('should be case insensitive', () => {
    expect(checkEmailContainsName('John.Smith@example.com', 'john', 'smith')).toBe(true)
  })

  it('should handle names with whitespace', () => {
    expect(checkEmailContainsName('john.smith@example.com', ' John ', ' Smith ')).toBe(true)
  })

  it('should not match email without the name', () => {
    expect(checkEmailContainsName('bob.jones@example.com', 'John', 'Smith')).toBe(false)
  })

  it('should return false for empty email', () => {
    expect(checkEmailContainsName('', 'John', 'Smith')).toBe(false)
  })

  it('should return false when no names provided', () => {
    expect(checkEmailContainsName('john.smith@example.com')).toBe(false)
  })

  it('should match when only first name provided and present', () => {
    expect(checkEmailContainsName('john@example.com', 'John')).toBe(true)
  })

  it('should match when only last name provided and present', () => {
    expect(checkEmailContainsName('smith@example.com', undefined, 'Smith')).toBe(true)
  })
})

describe('checkCompanyDomain', () => {
  it('should match email with company domain', () => {
    expect(checkCompanyDomain('test@mycompany.com', ['mycompany'])).toBe(true)
  })

  it('should match email with subdomain', () => {
    expect(checkCompanyDomain('test@mail.mycompany.com', ['mycompany'])).toBe(true)
  })

  it('should be case insensitive', () => {
    expect(checkCompanyDomain('test@MyCompany.COM', ['mycompany'])).toBe(true)
  })

  it('should match any keyword in the list', () => {
    expect(checkCompanyDomain('test@partner.com', ['mycompany', 'partner', 'vendor'])).toBe(true)
  })

  it('should not match different domain', () => {
    expect(checkCompanyDomain('test@other.com', ['mycompany'])).toBe(false)
  })

  it('should return false for invalid email', () => {
    expect(checkCompanyDomain('notanemail', ['mycompany'])).toBe(false)
  })

  it('should return false for empty email', () => {
    expect(checkCompanyDomain('', ['mycompany'])).toBe(false)
  })

  it('should return false for empty keywords', () => {
    expect(checkCompanyDomain('test@mycompany.com', [])).toBe(false)
  })

  it('should return false for undefined keywords', () => {
    expect(checkCompanyDomain('test@mycompany.com', undefined as any)).toBe(false)
  })

  it('should handle partial domain matches', () => {
    expect(checkCompanyDomain('test@mycompanycorp.com', ['mycompany'])).toBe(true)
  })
})

describe('checkSocialGood', () => {
  it('should return true for "social good"', () => {
    expect(checkSocialGood('social good')).toBe(true)
  })

  it('should be case insensitive', () => {
    expect(checkSocialGood('Social Good')).toBe(true)
    expect(checkSocialGood('SOCIAL GOOD')).toBe(true)
    expect(checkSocialGood('SoCiAl GoOd')).toBe(true)
  })

  it('should handle whitespace', () => {
    expect(checkSocialGood('  social good  ')).toBe(true)
  })

  it('should return false for other product types', () => {
    expect(checkSocialGood('regular')).toBe(false)
    expect(checkSocialGood('premium')).toBe(false)
  })

  it('should return false for partial matches', () => {
    expect(checkSocialGood('social')).toBe(false)
    expect(checkSocialGood('good')).toBe(false)
  })

  it('should return false for empty string', () => {
    expect(checkSocialGood('')).toBe(false)
  })
})

describe('applyTransformRules', () => {
  let metadata: Map<string, UserMetadataFull>

  beforeEach(() => {
    metadata = new Map()
    metadata.set('user-123', {
      user_id: 'user-123',
      email: 'john.doe@personal.com',
      emails: ['john.doe@personal.com', 'j.doe@alternate.com'],
      first_name: 'John',
      last_name: 'Doe'
    })
  })

  it('should apply Decision and Reason as first columns', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'test@example.com', 'User Name': 'user-999', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows)
    expect(result).toHaveLength(1)
    const row = result[0]
    expect(row).toBeDefined()
    const keys = Object.keys(row!)
    
    expect(keys[0]).toBe('Decision')
    expect(keys[1]).toBe('Reason')
  })

  it('should mark as Y when email matches metadata exactly', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'john.doe@personal.com', 'User Name': 'user-123', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, metadata)
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email matches user metadata')
  })

  it('should mark as Y when email matches secondary metadata email', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'j.doe@alternate.com', 'User Name': 'user-123', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, metadata)
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email matches user metadata')
  })

  it('should mark as Y when email contains user name', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'john.work@company.com', 'User Name': 'user-123', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, metadata)
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email contains user name (John Doe)')
  })

  it('should mark as Y for company domain', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'test@mycompany.com', 'User Name': 'user-999', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, metadata, ['mycompany'], 'MyCompany')
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email is under MyCompany domain')
  })

  it('should use default company name when not provided', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'test@mycompany.com', 'User Name': 'user-999', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, metadata, ['mycompany'])
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email is under company domain')
  })

  it('should mark as Y for social good product', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'test@unknown.com', 'User Name': 'user-999', 'Product Type': 'social good' }
    ]
    
    const result = applyTransformRules(rows, metadata)
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Product type is Social Good')
  })

  it('should mark as N when no rules match', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'unknown@unknown.com', 'User Name': 'user-999', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, metadata)
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('N')
    expect(result[0]!['Reason']).toBe('No verification rule matched')
  })

  it('should preserve all original columns', () => {
    const rows: DataRow[] = [
      { 
        'Email Address': 'test@example.com', 
        'User Name': 'user-999', 
        'Product Type': 'regular',
        'Order ID': '12345',
        'Amount': 100
      }
    ]
    
    const result = applyTransformRules(rows, metadata)
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Email Address']).toBe('test@example.com')
    expect(result[0]!['User Name']).toBe('user-999')
    expect(result[0]!['Product Type']).toBe('regular')
    expect(result[0]!['Order ID']).toBe('12345')
    expect(result[0]!['Amount']).toBe(100)
  })

  it('should prioritize email match over name match', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'john.doe@personal.com', 'User Name': 'user-123', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, metadata)
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email matches user metadata')
  })

  it('should prioritize name match over company domain', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'john.work@mycompany.com', 'User Name': 'user-123', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, metadata, ['mycompany'], 'MyCompany')
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email contains user name (John Doe)')
  })

  it('should prioritize company domain over social good', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'test@mycompany.com', 'User Name': 'user-999', 'Product Type': 'social good' }
    ]
    
    const result = applyTransformRules(rows, metadata, ['mycompany'], 'MyCompany')
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email is under MyCompany domain')
  })

  it('should handle multiple rows independently', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'john.doe@personal.com', 'User Name': 'user-123', 'Product Type': 'regular' },
      { 'Email Address': 'unknown@unknown.com', 'User Name': 'user-999', 'Product Type': 'regular' },
      { 'Email Address': 'test@unknown.com', 'User Name': 'user-999', 'Product Type': 'social good' }
    ]
    
    const result = applyTransformRules(rows, metadata)
    expect(result).toHaveLength(3)
    
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email matches user metadata')
    
    expect(result[1]!['Decision']).toBe('N')
    expect(result[1]!['Reason']).toBe('No verification rule matched')
    
    expect(result[2]!['Decision']).toBe('Y')
    expect(result[2]!['Reason']).toBe('Product type is Social Good')
  })

  it('should handle missing fields gracefully', () => {
    const rows: DataRow[] = [
      { 'Some Other Field': 'value' }
    ]
    
    const result = applyTransformRules(rows, metadata)
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('N')
    expect(result[0]!['Reason']).toBe('No verification rule matched')
  })

  it('should handle empty metadata map', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'test@example.com', 'User Name': 'user-123', 'Product Type': 'regular' }
    ]
    
    const emptyMetadata = new Map<string, UserMetadataFull>()
    const result = applyTransformRules(rows, emptyMetadata)
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('N')
  })

  it('should handle undefined metadata', () => {
    const rows: DataRow[] = [
      { 'Email Address': 'test@example.com', 'User Name': 'user-123', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows)
    expect(result).toHaveLength(1)
    
    expect(result[0]!['Decision']).toBe('N')
  })

  it('should match when email contains first name part even with compound last name', () => {
    const compoundNameMetadata = new Map<string, UserMetadataFull>()
    compoundNameMetadata.set('user-456', {
      user_id: 'user-456',
      email: 'differentemail@example.com',
      emails: ['differentemail@example.com'],
      first_name: 'john',
      last_name: 'terry smith'
    })

    const rows: DataRow[] = [
      { 'Email Address': 'john.terrysmith@example.com', 'User Name': 'user-456', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, compoundNameMetadata)
    expect(result).toHaveLength(1)
    
    // Should match because 'john' is found as an exact part in 'john.terrysmith'
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email contains user name (john terry smith)')
  })

  it('should match when email contains last name as substring even with compound first name', () => {
    const compoundNameMetadata = new Map<string, UserMetadataFull>()
    compoundNameMetadata.set('user-789', {
      user_id: 'user-789',
      email: 'differentemail@example.com',
      emails: ['differentemail@example.com'],
      first_name: 'john terry',
      last_name: 'smith'
    })

    const rows: DataRow[] = [
      { 'Email Address': 'johnterrysmith@example.com', 'User Name': 'user-789', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, compoundNameMetadata)
    expect(result).toHaveLength(1)
    
    // Should match because 'smith' is found as substring in 'johnterrysmith'
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email contains user name (john terry smith)')
  })

  it('should match when email contains first name even with numbers', () => {
    const nameWithNumbersMetadata = new Map<string, UserMetadataFull>()
    nameWithNumbersMetadata.set('user-999', {
      user_id: 'user-999',
      email: 'differentemail@example.com',
      emails: ['differentemail@example.com'],
      first_name: 'Alice',
      last_name: 'Johnson'
    })

    const rows: DataRow[] = [
      { 'Email Address': 'Alice888222@gmail.com', 'User Name': 'user-999', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, nameWithNumbersMetadata)
    expect(result).toHaveLength(1)
    
    // Should match because 'alice' is found as substring in 'alice888222'
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email contains user name (Alice Johnson)')
  })

  it('should match when email contains part of compound last name', () => {
    const compoundLastNameMetadata = new Map<string, UserMetadataFull>()
    compoundLastNameMetadata.set('user-888', {
      user_id: 'user-888',
      email: 'differentemail@example.com',
      emails: ['differentemail@example.com'],
      first_name: 'Robert',
      last_name: 'Alice Johnson'  // Compound last name containing 'Alice'
    })

    const rows: DataRow[] = [
      { 'Email Address': 'Alice888222@gmail.com', 'User Name': 'user-888', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, compoundLastNameMetadata)
    expect(result).toHaveLength(1)
    
    // Should match because 'alice' is part of the compound last name 'Alice Johnson'
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email contains user name (Robert Alice Johnson)')
  })

  it('should match when email contains parts of compound first name concatenated', () => {
    const compoundFirstNameMetadata = new Map<string, UserMetadataFull>()
    compoundFirstNameMetadata.set('user-777', {
      user_id: 'user-777',
      email: 'differentemail@example.com',
      emails: ['differentemail@example.com'],
      first_name: 'Sarah Michelle',  // Compound first name
      last_name: 'Thompson'
    })

    const rows: DataRow[] = [
      { 'Email Address': 'fsarahmichelle106@gmail.com', 'User Name': 'user-777', 'Product Type': 'regular' }
    ]
    
    const result = applyTransformRules(rows, compoundFirstNameMetadata)
    expect(result).toHaveLength(1)
    
    // Should match because 'sarah' and 'michelle' are both found as substrings in 'fsarahmichelle106'
    expect(result[0]!['Decision']).toBe('Y')
    expect(result[0]!['Reason']).toBe('Email contains user name (Sarah Michelle Thompson)')
  })
})

