import { app } from 'electron'
import path from 'node:path'
import * as fs from 'fs'
import log from 'electron-log'
import type { AppSettings } from './types'

const DEFAULT_SETTINGS: AppSettings = {
  companyName: '',
  defaultApiUrl: '',
  emailDomainKeywords: []
}

export class SettingsManager {
  private settingsPath: string
  private settings: AppSettings

  constructor() {
    // Store settings in user data directory
    const userDataPath = app.getPath('userData')
    this.settingsPath = path.join(userDataPath, 'app-settings.json')
    this.settings = this.loadSettings()
  }

  private loadSettings(): AppSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf-8')
        const loaded = JSON.parse(data) as Partial<AppSettings>
        
        // Merge with defaults to ensure all fields exist
        return {
          ...DEFAULT_SETTINGS,
          ...loaded
        }
      }
    } catch (error) {
      log.error('[ERROR] Failed to load settings:', error)
    }
    
    return { ...DEFAULT_SETTINGS }
  }

  private saveSettings(): void {
    try {
      const userDataPath = app.getPath('userData')
      fs.mkdirSync(userDataPath, { recursive: true })
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (error) {
      log.error('[ERROR] Failed to save settings:', error)
      throw error
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  updateSettings(updates: Partial<AppSettings>): void {
    this.settings = {
      ...this.settings,
      ...updates
    }
    this.saveSettings()
  }

  resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS }
    this.saveSettings()
  }
}

// Global settings manager instance
let settingsManager: SettingsManager

export function getSettingsManager(): SettingsManager {
  if (!settingsManager) {
    settingsManager = new SettingsManager()
  }
  return settingsManager
}

