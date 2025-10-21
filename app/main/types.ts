// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

// Settings
export interface AppSettings {
  companyName: string
  defaultApiUrl: string
  emailDomainKeywords: string[]
}

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

export interface ApiUserMetadata {
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

export interface UserMetadataFull {
  user_id: string
  email: string
  emails?: string[] | undefined
  first_name?: string
  last_name?: string
}

// Credentials Store
export interface CredsStore {
  save(name: string, creds: NtlmCredentials): Promise<void>
  has(name: string): Promise<boolean>
  del(name: string): Promise<boolean>
  list(): Promise<string[]>
  get(name: string): Promise<NtlmCredentials | null>
}

