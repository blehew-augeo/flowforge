import { contextBridge, ipcRenderer } from 'electron'
import type {
  SaveConnectionArgs,
  TestConnectionArgs,
  RunWorkflowRequest,
  NetworkRequest,
  AuthPreflightRequest,
  AuthProvideCredentialsRequest,
  AppSettings
} from './types'

// Expose API to renderer via contextBridge
// All handlers are typed and map directly to IPC channels
contextBridge.exposeInMainWorld('api', {
  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Connection management
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: (args: SaveConnectionArgs) => ipcRenderer.invoke('connections:save', args),
    delete: (name: string) => ipcRenderer.invoke('connections:delete', name),
    test: (args: TestConnectionArgs) => ipcRenderer.invoke('connections:test', args),
    get: (name: string) => ipcRenderer.invoke('connections:get', name)
  },

  // File operations
  files: {
    selectFile: (accept?: string) => ipcRenderer.invoke('files:selectFile', accept),
    previewFile: (path: string) => ipcRenderer.invoke('files:previewFile', path)
  },

  // Workflow
  workflow: {
    run: (request: RunWorkflowRequest) => ipcRenderer.invoke('workflow:run', request)
  },

  // System
  system: {
    openPath: (path: string) => ipcRenderer.invoke('system:openPath', path)
  },

  // Network
  network: {
    request: (req: NetworkRequest) => ipcRenderer.invoke('network:request', req)
  },

  // Auth
  auth: {
    preflight: (req: AuthPreflightRequest) => ipcRenderer.invoke('auth:preflight', req),
    provideCredentials: (req: AuthProvideCredentialsRequest) => ipcRenderer.invoke('auth:provideCredentials', req)
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (updates: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', updates),
    reset: () => ipcRenderer.invoke('settings:reset')
  }
})
