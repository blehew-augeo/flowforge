import { app, BrowserWindow, session, dialog } from 'electron'
import path from 'node:path'
import * as fs from 'fs'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import log from 'electron-log'
import type { CredsStore } from './types'
import { getSettingsManager } from './SettingsManager'
import { KeytarCredsStore } from './KeytarCredsStore'
import { InMemoryCredsStore } from './InMemoryCredsStore'

// Import IPC registration
import { registerIpc } from './ipc'
import type { IpcContext } from './ipc'
import { registerConnection } from './connectionRegistry'
import { initDb, closeDb, dbContext } from './db'

// =============================================================================
// CREDENTIALS STORE
// =============================================================================

// Global instance - can be swapped for testing
let credsStoreInstance: CredsStore = new KeytarCredsStore()

export function getCredsStore(): CredsStore {
  return credsStoreInstance
}

export function setCredsStore(store: CredsStore): void {
  credsStoreInstance = store
}


// =============================================================================
// ELECTRON APP & IPC HANDLERS
// =============================================================================

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Keep false for now due to native modules (keytar)
      webSecurity: true, // Enforce web security
      allowRunningInsecureContent: false, // Block mixed content
      experimentalFeatures: false, // Disable experimental features
      enableBlinkFeatures: '', // Don't enable any additional Blink features
      disableBlinkFeatures: 'AutomationControlled' // Security feature
    }
  })

  const devServer = process.env['VITE_DEV_SERVER_URL']
  if (devServer) {
    mainWindow.loadURL(devServer)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Security: Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    
    // Allow navigation to dev server in development
    if (devServer && navigationUrl.startsWith(devServer)) {
      return
    }
    
    // Block all other navigation attempts
    log.warn('[SECURITY] Blocked navigation attempt to:', navigationUrl)
    event.preventDefault()
  })

  // Security: Prevent opening new windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log.warn('[SECURITY] Blocked window.open attempt to:', url)
    return { action: 'deny' }
  })
}

// =============================================================================
// AUTO-UPDATER
// =============================================================================

function setupAutoUpdater() {
  // Configure auto-updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = log
  log.transports.file.level = 'info'

  // Log basic app/update context
  try {
    log.info(`[UPDATE] App ${app.getName()} v${app.getVersion()}`)
    const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml')
    if (fs.existsSync(updateConfigPath)) {
      const cfg = fs.readFileSync(updateConfigPath, 'utf-8')
      log.info('[UPDATE] app-update.yml found:\n' + cfg)
    } else {
      log.warn('[UPDATE] app-update.yml not found in resources (portable build cannot auto-update)')
    }
  } catch (e) {
    log.error('[UPDATE] Failed to log update context:', e)
  }

  // Log update events
  autoUpdater.on('checking-for-update', () => {
    log.info('[UPDATE] Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    log.info('[UPDATE] Update available: ' + info.version)
    
    // Ask user if they want to download the update
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available. Would you like to download it now?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1
      }).then(result => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate()
        }
      })
    }
  })

  autoUpdater.on('update-not-available', () => {
    log.info('[UPDATE] No updates available')
  })

  autoUpdater.on('download-progress', (progress) => {
    log.info(`[UPDATE] Download progress: ${Math.round(progress.percent)}%`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[UPDATE] Update downloaded: ' + info.version)
    
    // Ask user if they want to install and restart
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded. Restart the application to install the update?`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1
      }).then(result => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall(false, true)
        }
      })
    }
  })

  autoUpdater.on('error', (error) => {
    const errMsg = error instanceof Error ? error.message : String(error)
    
    // Detect common cases and log appropriately
    if (errMsg.includes('Unable to find latest version') || errMsg.includes('HttpError: 406')) {
      log.info('[UPDATE] No production releases available on GitHub yet')
    } else if (errMsg.includes('ENOTFOUND') || errMsg.includes('ETIMEDOUT')) {
      log.warn('[UPDATE] Update check failed: Network unavailable')
    } else {
      log.error('[UPDATE] Update check failed:', errMsg)
    }
  })

  // Check for updates on startup (skip in development)
  if (!process.env['VITE_DEV_SERVER_URL']) {
    // Wait 3 seconds after app start to check for updates
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg.includes('Unable to find latest version') || errMsg.includes('HttpError: 406')) {
          log.info('[UPDATE] No production releases available yet - first install or waiting for releases')
        } else {
          log.warn('[UPDATE] Update check skipped:', errMsg)
        }
      })
    }, 3000)
  }
}

// =============================================================================
// WINDOWS INTEGRATED AUTHENTICATION SETUP
// =============================================================================
// These command line switches must be set BEFORE app.whenReady()
// They enable NTLM/Kerberos authentication for Windows Integrated Auth

// Allow authentication for all servers (use specific domain in production for security)
app.commandLine.appendSwitch('auth-server-whitelist', '*')
app.commandLine.appendSwitch('auth-negotiate-delegate-whitelist', '*')
// Enable authentication on non-standard ports
app.commandLine.appendSwitch('enable-auth-negotiate-port', 'true')

log.info('[AUTH] Windows Integrated Authentication enabled for all servers')

app.whenReady().then(async () => {
  // Initialize settings manager first
  const settingsManager = getSettingsManager()

  // Use in-memory creds store for testing
  if (process.env['NODE_ENV'] === 'test') {
    setCredsStore(new InMemoryCredsStore())
  }

  // Initialize database
  try {
    initDb()
    log.info('[APP] Database initialized')
  } catch (error) {
    log.error('[APP] Failed to initialize database:', error)
    // Continue without database - handlers will be skipped
  }

  // Register default connection (always available)
  registerConnection('default')
  
  // Set system proxy
  await session.defaultSession.setProxy({ mode: 'system' })

  // Security: Configure session security settings
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // Add security headers
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block']
      }
    })
  })

  // Register all IPC handlers with database context
  const ipcContext: IpcContext = {
    credsStore: getCredsStore(),
    settingsManager,
    db: dbContext
  }
  registerIpc(ipcContext)
  
  createWindow()
  
  // Setup auto-updater after window is created
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Handle HTTP authentication challenges for browser window
// Note: Per-request auth is handled in network/index.ts for net.request()
app.on('login', async (event, webContents, request, authInfo, callback) => {
  log.info('[AUTH] ==========================================')
  log.info('[AUTH] Global login event triggered (browser window)')
  log.info('[AUTH] URL:', request.url)
  log.info('[AUTH] Auth scheme:', authInfo.scheme)
  log.info('[AUTH] Auth realm:', authInfo.realm)
  log.info('[AUTH] Auth host:', authInfo.host)
  log.info('[AUTH] Auth port:', authInfo.port)
  log.info('[AUTH] Is proxy:', authInfo.isProxy)
  log.info('[AUTH] Windows Username:', process.env['USERNAME'])
  log.info('[AUTH] Windows Domain:', process.env['USERDOMAIN'])
  log.info('[AUTH] Using Windows Integrated Auth')
  log.info('[AUTH] ==========================================')
  
  // Use Windows Integrated Auth for browser window requests
  // Don't call event.preventDefault() so Electron uses the logged-in user's credentials
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Clean up database connection
  closeDb()
  log.info('[APP] Application shutting down')
})
