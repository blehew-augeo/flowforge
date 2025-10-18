import { contextBridge, ipcRenderer } from 'electron'

// Expose API to renderer
contextBridge.exposeInMainWorld('api', {
  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Connection management
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: (args: { name: string; domain: string; username: string; password: string }) => 
      ipcRenderer.invoke('connections:save', args),
    delete: (name: string) => ipcRenderer.invoke('connections:delete', name),
    test: (args: { name: string; url: string }) => ipcRenderer.invoke('connections:test', args),
    get: (name: string) => ipcRenderer.invoke('connections:get', name)
  },

  // File operations
  files: {
    selectFile: (accept?: string) => ipcRenderer.invoke('files:selectFile', accept),
    previewFile: (path: string) => ipcRenderer.invoke('files:previewFile', path),
    // Test helper: directly set file path without dialog
    testSetFile: (path: string) => ipcRenderer.invoke('files:previewFile', path)
  },

  // Workflow
  workflow: {
    run: (request: any) => ipcRenderer.invoke('workflow:run', request)
  },

  // System
  system: {
    openPath: (path: string) => ipcRenderer.invoke('system:openPath', path)
  },

  // Network
  network: {
    request: (req: any) => ipcRenderer.invoke('network:request', req)
  },

  // Auth
  auth: {
    preflight: (req: any) => ipcRenderer.invoke('auth:preflight', req),
    provideCredentials: (req: any) => ipcRenderer.invoke('auth:provideCredentials', req)
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (updates: any) => ipcRenderer.invoke('settings:update', updates),
    reset: () => ipcRenderer.invoke('settings:reset')
  }

})
