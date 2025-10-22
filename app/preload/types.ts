// Type definitions for the IPC API

export interface Connection {
  name: string
  hasCreds: boolean
}

export interface SaveConnectionArgs {
  name: string
  apiUrl: string
  domain?: string
  username?: string
  password?: string
}

export interface TestConnectionArgs {
  name: string
  url: string
}

export interface TestConnectionResponse {
  ok: boolean
}

export interface NtlmCredentials {
  domain: string
  username: string
  password: string
}

export interface FilePreview {
  name: string
  rows: number
  sample: Array<Record<string, unknown>>
}

export interface RunWorkflowRequest {
  inputPath: string
  connectionName: string
  apiUrl: string
}

export interface RunWorkflowResponse {
  ok: boolean
  artifactDir: string
  reportPath: string
  error?: string
}

export interface NetworkRequest {
  method?: string
  url: string
  headers?: Record<string, string>
  body?: string
  connectionId?: string
}

export interface NetworkResponse {
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

export interface AppSettings {
  companyName: string
  defaultApiUrl: string
  emailDomainKeywords: string[]
}

export interface ApiInterface {
  getVersion: () => Promise<string>
  
  connections: {
    list: () => Promise<Connection[]>
    save: (args: SaveConnectionArgs) => Promise<void>
    delete: (name: string) => Promise<void>
    test: (args: TestConnectionArgs) => Promise<TestConnectionResponse>
    get: (name: string) => Promise<NtlmCredentials | null>
  }
  
  files: {
    selectFile: (accept?: string) => Promise<string | null>
    previewFile: (path: string) => Promise<FilePreview>
  }
  
  workflow: {
    run: (request: RunWorkflowRequest) => Promise<RunWorkflowResponse>
  }
  
  system: {
    openPath: (path: string) => Promise<void>
  }
  
  network: {
    request: (req: NetworkRequest) => Promise<NetworkResponse>
  }
  
  auth: {
    preflight: (req: AuthPreflightRequest) => Promise<AuthPreflightResponse>
    provideCredentials: (req: AuthProvideCredentialsRequest) => Promise<AuthProvideCredentialsResponse>
  }
  
  settings: {
    get: () => Promise<AppSettings>
    update: (updates: Partial<AppSettings>) => Promise<void>
    reset: () => Promise<void>
  }
}

declare global {
  interface Window {
    api: ApiInterface
  }
}

export {}
