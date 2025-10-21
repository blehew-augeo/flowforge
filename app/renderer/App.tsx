import React, { useState, useEffect } from 'react'
import * as Label from '@radix-ui/react-label'

// Type definitions
interface FilePreview {
  name: string
  rows: number
  sample: Array<Record<string, unknown>>
}

interface AppSettings {
  companyName: string
  defaultApiUrl: string
  emailDomainKeywords: string[]
}

// Use a constant default connection name
const DEFAULT_CONNECTION = 'default'

interface CredentialModalProps {
  isOpen: boolean
  connectionId: string
  baseUrl: string
  domainHint: string
  onClose: () => void
  onSuccess: () => void
}

// Credential Modal Component
function CredentialModal({ isOpen, connectionId, baseUrl, domainHint, onClose, onSuccess }: CredentialModalProps) {
  const [domain, setDomain] = useState(domainHint)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setDomain(domainHint)
      setUsername('')
      setPassword('')
      setError('')
      setSubmitting(false)
    }
  }, [isOpen, domainHint])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!domain || !username || !password) {
      setError('All fields are required')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const result = await window.api.auth.provideCredentials({
        connectionId,
        baseUrl,
        domain,
        username,
        password
      })

      if (result.ok) {
        onSuccess()
        onClose()
      } else {
        setError(result.error || 'Authentication failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div 
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '24px',
          width: '400px',
          maxWidth: '90%',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, marginBottom: '20px' }}>Sign in to Corporate Network</h2>
        
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <Label.Root htmlFor="modal-domain" style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
              Domain
            </Label.Root>
            <input
              id="modal-domain"
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={submitting}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
              placeholder="e.g., CORP"
              autoFocus
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <Label.Root htmlFor="modal-username" style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
              Username
            </Label.Root>
            <input
              id="modal-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
              placeholder="e.g., john.doe"
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <Label.Root htmlFor="modal-password" style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
              Password
            </Label.Root>
            <input
              id="modal-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
              placeholder="Enter password"
            />
          </div>

          {error && (
            <div 
              style={{
                marginBottom: '15px',
                padding: '10px',
                backgroundColor: '#f8d7da',
                color: '#721c24',
                border: '1px solid #f5c6cb',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!domain || !username || !password || submitting}
              style={{
                padding: '10px 20px',
                backgroundColor: domain && username && password && !submitting ? '#007bff' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: domain && username && password && !submitting ? 'pointer' : 'not-allowed',
                fontSize: '14px',
                fontWeight: 500
              }}
            >
              {submitting ? 'Signing in...' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Settings Modal Component
interface SettingsModalProps {
  isOpen: boolean
  settings: AppSettings
  onClose: () => void
  onSave: (settings: AppSettings) => void
}

function SettingsModal({ isOpen, settings, onClose, onSave }: SettingsModalProps) {
  const [companyName, setCompanyName] = useState(settings.companyName)
  const [defaultApiUrl, setDefaultApiUrl] = useState(settings.defaultApiUrl)
  const [emailDomainKeywords, setEmailDomainKeywords] = useState(settings.emailDomainKeywords.join(', '))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setCompanyName(settings.companyName)
      setDefaultApiUrl(settings.defaultApiUrl)
      setEmailDomainKeywords(settings.emailDomainKeywords.join(', '))
      setSaving(false)
    }
  }, [isOpen, settings])

  if (!isOpen) return null

  const handleSave = () => {
    setSaving(true)
    const keywords = emailDomainKeywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0)
    
    onSave({
      companyName,
      defaultApiUrl,
      emailDomainKeywords: keywords
    })
    setSaving(false)
    onClose()
  }

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div 
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '24px',
          width: '500px',
          maxWidth: '90%',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, marginBottom: '20px' }}>Application Settings</h2>
        
        <div style={{ marginBottom: '15px' }}>
          <Label.Root htmlFor="settings-company-name" style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
            Company Name
          </Label.Root>
          <input
            id="settings-company-name"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            disabled={saving}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
            placeholder="e.g., Acme Corp"
          />
          <p style={{ margin: '5px 0 0 0', color: '#666', fontSize: '12px' }}>
            This name will appear in verification reason messages
          </p>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <Label.Root htmlFor="settings-api-url" style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
            Default API URL
          </Label.Root>
          <input
            id="settings-api-url"
            type="text"
            value={defaultApiUrl}
            onChange={(e) => setDefaultApiUrl(e.target.value)}
            disabled={saving}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
            placeholder="e.g., https://example.com"
          />
          <p style={{ margin: '5px 0 0 0', color: '#666', fontSize: '12px' }}>
            The default URL used for API requests
          </p>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <Label.Root htmlFor="settings-email-keywords" style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
            Email Domain Keywords
          </Label.Root>
          <input
            id="settings-email-keywords"
            type="text"
            value={emailDomainKeywords}
            onChange={(e) => setEmailDomainKeywords(e.target.value)}
            disabled={saving}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
            placeholder="e.g., acme, acmecorp"
          />
          <p style={{ margin: '5px 0 0 0', color: '#666', fontSize: '12px' }}>
            Comma-separated keywords to match in email domains for verification
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 20px',
              backgroundColor: saving ? '#ccc' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Main App Component
function App() {
  const [output, setOutput] = useState<string>('')
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [fileError, setFileError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [selectedFilePath, setSelectedFilePath] = useState<string>('')
  const [apiUrl, setApiUrl] = useState<string>('')
  const [settings, setSettings] = useState<AppSettings>({
    companyName: '',
    defaultApiUrl: '',
    emailDomainKeywords: []
  })
  const [showSettings, setShowSettings] = useState(false)
  
  // Output file preview state
  const [outputPreview, setOutputPreview] = useState<FilePreview | null>(null)
  const [outputPreviewExpanded, setOutputPreviewExpanded] = useState(false)
  const [outputArtifactDir, setOutputArtifactDir] = useState<string>('')
  const [outputReportPath, setOutputReportPath] = useState<string>('')
  const [outputDataFilePath, setOutputDataFilePath] = useState<string>('')

  // Credential modal state
  const [modalState, setModalState] = useState<{
    isOpen: boolean
    connectionId: string
    baseUrl: string
    domainHint: string
    onSuccess: () => void
  }>({
    isOpen: false,
    connectionId: DEFAULT_CONNECTION,
    baseUrl: '',
    domainHint: '',
    onSuccess: () => {}
  })

  // Load settings and API URL on startup
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loadedSettings = await window.api.settings.get()
        setSettings(loadedSettings)
        
        // Use default API URL from settings if available
        const savedApiUrl = localStorage.getItem('apiUrl')
        if (savedApiUrl) {
          setApiUrl(savedApiUrl)
        } else if (loadedSettings.defaultApiUrl) {
          setApiUrl(loadedSettings.defaultApiUrl)
        }
        
        // Show settings modal if no settings configured
        if (!loadedSettings.companyName || !loadedSettings.defaultApiUrl || loadedSettings.emailDomainKeywords.length === 0) {
          setShowSettings(true)
        }
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    }
    
    loadSettings()

    // Test helper: expose function to set file for e2e tests
    if (typeof window !== 'undefined') {
      (window as any).__testSetFile = async (filePath: string) => {
        try {
          setFileError('')
          setLoading(true)
          setSelectedFilePath(filePath)
          const previewData = await window.api.files.previewFile(filePath)
          setPreview(previewData)
          setPreviewExpanded(false)
        } catch (err) {
          setFileError(err instanceof Error ? err.message : String(err))
          setPreview(null)
          setSelectedFilePath('')
        } finally {
          setLoading(false)
        }
      }
    }
  }, [])

  const handleApiUrlChange = (newUrl: string) => {
    setApiUrl(newUrl)
    localStorage.setItem('apiUrl', newUrl)
  }

  const handleSaveSettings = async (newSettings: AppSettings) => {
    try {
      await window.api.settings.update(newSettings)
      setSettings(newSettings)
      
      // If API URL is empty and default is set, use it
      if (!apiUrl && newSettings.defaultApiUrl) {
        setApiUrl(newSettings.defaultApiUrl)
        localStorage.setItem('apiUrl', newSettings.defaultApiUrl)
      }
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }

  const handleRunWorkflow = async () => {
    if (!selectedFilePath) {
      setOutput('Error: Please select a file first')
      return
    }
    
    if (!apiUrl) {
      setOutput('Error: Please enter an API URL')
      return
    }

    // Preflight check before running workflow
    setOutput('Checking connection...')
    
    try {
      const preflightResult = await window.api.auth.preflight({
        connectionId: DEFAULT_CONNECTION,
        baseUrl: apiUrl
      })

      if (preflightResult.mode === 'needs-vpn' || preflightResult.mode === 'unreachable') {
        setOutput(`Cannot run workflow: ${preflightResult.details}\n\nPlease check your VPN connection and try again.`)
        return
      }

      if (preflightResult.mode === 'auth-required') {
        // Need to authenticate first - show credential modal
        setModalState({
          isOpen: true,
          connectionId: DEFAULT_CONNECTION,
          baseUrl: apiUrl,
          domainHint: '',
          onSuccess: () => {
            // After successful auth, run the workflow
            runWorkflow()
          }
        })
        return
      }

      // Silent-ok, proceed with workflow
      await runWorkflow()
    } catch (error) {
      setOutput(`Error during preflight: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const runWorkflow = async () => {
    try {
      setOutput('Running workflow...')
      const result = await window.api.workflow.run({
        inputPath: selectedFilePath,
        connectionName: DEFAULT_CONNECTION,
        apiUrl
      })
      
      if (result.ok) {
        setOutput(`Workflow completed successfully!\n\nArtifacts: ${result.artifactDir}\nReport: ${result.reportPath}`)
        
        // Store output paths
        setOutputArtifactDir(result.artifactDir)
        setOutputReportPath(result.reportPath)
        
        // Find the actual output data file (output.csv or output.xlsx) in the artifact directory
        try {
          // Try to find output.xlsx first, then output.csv
          const possibleOutputFiles = ['output.xlsx', 'output.csv']
          let outputDataPath = ''
          
          for (const filename of possibleOutputFiles) {
            const testPath = `${result.artifactDir}/${filename}`.replace(/\\/g, '/')
            try {
              const previewData = await window.api.files.previewFile(testPath)
              outputDataPath = testPath
              setOutputDataFilePath(testPath)
              setOutputPreview(previewData)
              setOutputPreviewExpanded(true)
              break
            } catch {
              // Try next file
              continue
            }
          }
          
          if (!outputDataPath) {
            console.warn('Could not find output.xlsx or output.csv in artifact directory')
            setOutputPreview(null)
            setOutputDataFilePath('')
          }
        } catch (err) {
          console.error('Failed to preview output file:', err)
          setOutputPreview(null)
          setOutputDataFilePath('')
        }
      } else {
        setOutput(`Workflow failed: ${result.error || 'Unknown error'}`)
        setOutputPreview(null)
        setOutputArtifactDir('')
        setOutputReportPath('')
        setOutputDataFilePath('')
      }
    } catch (error) {
      setOutput(`Error: ${error instanceof Error ? error.message : String(error)}`)
      setOutputPreview(null)
      setOutputArtifactDir('')
      setOutputReportPath('')
      setOutputDataFilePath('')
    }
  }

  const handleFileSelect = async () => {
    try {
      setFileError('')
      setLoading(true)
      
      const filePath = await window.api.files.selectFile('data')
      
      if (!filePath) {
        setLoading(false)
        return
      }

      setSelectedFilePath(filePath)
      const previewData = await window.api.files.previewFile(filePath)
      setPreview(previewData)
      setPreviewExpanded(false)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err))
      setPreview(null)
      setSelectedFilePath('')
    } finally {
      setLoading(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const files = e.dataTransfer.files
    if (files.length === 0) return

    const file = files[0]
    if (!file) return

    const ext = file.name.toLowerCase().split('.').pop()
    if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'csv') {
      setFileError('Only .xlsx and .csv files are supported')
      return
    }

    try {
      setFileError('')
      setLoading(true)
      
      const filePath = (file as any).path as string
      
      if (!filePath) {
        setFileError('Could not access file path')
        return
      }

      setSelectedFilePath(filePath)
      const previewData = await window.api.files.previewFile(filePath)
      setPreview(previewData)
      setPreviewExpanded(false)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err))
      setPreview(null)
      setSelectedFilePath('')
    } finally {
      setLoading(false)
    }
  }


  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px' }}>

      {/* Settings Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
        <button
          onClick={() => setShowSettings(true)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500
          }}
        >
          Settings
        </button>
      </div>

      {/* Credential Modal */}
      <CredentialModal
        isOpen={modalState.isOpen}
        connectionId={modalState.connectionId}
        baseUrl={modalState.baseUrl}
        domainHint={modalState.domainHint}
        onClose={() => setModalState({ ...modalState, isOpen: false })}
        onSuccess={modalState.onSuccess}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        settings={settings}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
      />

      {/* File Upload Section */}
      <div style={{ marginBottom: '30px' }}>
        <h2>File Input</h2>
        <div
          data-testid="file-input"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          style={{
            border: '2px dashed #ddd',
            borderRadius: '8px',
            padding: '40px',
            textAlign: 'center',
            backgroundColor: '#f9f9f9',
            cursor: 'pointer',
            marginBottom: '15px'
          }}
          onClick={handleFileSelect}
        >
          <p style={{ margin: 0, color: '#666', fontSize: '16px' }}>
            Click to select or drag and drop an XLSX or CSV file
          </p>
          <p style={{ margin: '10px 0 0 0', color: '#999', fontSize: '14px' }}>
            Supported formats: .xlsx, .xls, .csv
          </p>
        </div>

        {loading && (
          <p style={{ color: '#007bff', textAlign: 'center' }}>Loading preview...</p>
        )}

        {fileError && (
          <div
            style={{
              padding: '10px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              border: '1px solid #f5c6cb',
              borderRadius: '4px',
              marginBottom: '15px'
            }}
          >
            {fileError}
          </div>
        )}

        {preview && (
          <div data-testid="file-preview" style={{ marginTop: '20px' }}>
            <div 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                marginBottom: '15px',
                cursor: 'pointer',
                padding: '10px',
                backgroundColor: '#f5f5f5',
                borderRadius: '4px'
              }}
              onClick={() => setPreviewExpanded(!previewExpanded)}
            >
              <div>
                <h3 style={{ margin: 0 }}>Preview: {preview.name}</h3>
                <p style={{ color: '#666', margin: '5px 0 0 0', fontSize: '14px' }}>
                  Total rows: <strong>{preview.rows}</strong>
                </p>
              </div>
              <button 
                style={{ 
                  padding: '5px 10px',
                  fontSize: '12px'
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setPreviewExpanded(!previewExpanded)
                }}
              >
                {previewExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {previewExpanded && (
              <div>
                <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '500px', border: '1px solid #ddd' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '14px'
                    }}
                  >
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr style={{ backgroundColor: '#f5f5f5' }}>
                        <th style={{ 
                          padding: '10px', 
                          border: '1px solid #ddd', 
                          textAlign: 'left',
                          fontWeight: 600 
                        }}>
                          #
                        </th>
                        {preview.sample.length > 0 &&
                          Object.keys(preview.sample[0] ?? {}).map((key) => (
                            <th
                              key={key}
                              style={{
                                padding: '10px',
                                border: '1px solid #ddd',
                                textAlign: 'left',
                                fontWeight: 600
                              }}
                            >
                              {key}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.slice(0, 100).map((row, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9f9f9' }}>
                          <td style={{ 
                            padding: '8px', 
                            border: '1px solid #ddd',
                            color: '#999'
                          }}>
                            {idx + 1}
                          </td>
                          {Object.values(row).map((value, colIdx) => (
                            <td
                              key={colIdx}
                              style={{
                                padding: '8px',
                                border: '1px solid #ddd',
                                maxWidth: '200px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {value === null || value === undefined
                                ? <span style={{ color: '#ccc' }}>null</span>
                                : String(value)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p style={{ color: '#666', marginTop: '15px', fontSize: '14px' }}>
                  Showing first {Math.min(preview.sample.length, 100)} of {preview.rows} rows
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Workflow Configuration */}
      <div style={{ marginBottom: '30px' }}>
        <h2>Run Workflow</h2>
        
        <div style={{ marginBottom: '15px' }}>
          <Label.Root htmlFor="api-url" style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
            API URL
          </Label.Root>
          <input
            id="api-url"
            type="text"
            value={apiUrl}
            onChange={(e) => handleApiUrlChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
            placeholder="Enter API URL"
          />
        </div>

        <button 
          onClick={handleRunWorkflow} 
          disabled={!selectedFilePath || !apiUrl}
          style={{ 
            padding: '10px 20px',
            backgroundColor: selectedFilePath && apiUrl ? '#28a745' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: selectedFilePath && apiUrl ? 'pointer' : 'not-allowed',
            fontSize: '16px',
            fontWeight: 500
          }}
        >
          Run Workflow
        </button>
      </div>

      <div style={{ marginTop: '20px' }}>
        <h2>Output:</h2>
        <pre
          style={{
            backgroundColor: '#f5f5f5',
            padding: '10px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            whiteSpace: 'pre-wrap',
            fontSize: '14px',
            maxHeight: '400px',
            overflowY: 'auto'
          }}
        >
          {output || 'Click a button to see IPC results...'}
        </pre>
      </div>

      {/* Output File Preview Section */}
      {outputPreview && (
        <div style={{ marginTop: '30px', borderTop: '2px solid #ddd', paddingTop: '20px' }}>
          <h2>Output File Preview</h2>
          
          <div style={{ marginBottom: '15px' }}>
            <button
              onClick={() => window.api.system.openPath(outputArtifactDir)}
              style={{
                padding: '10px 20px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                marginRight: '10px'
              }}
            >
              Open Output Folder
            </button>
            {outputDataFilePath && (
              <button
                onClick={() => window.api.system.openPath(outputDataFilePath)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                Open Output File
              </button>
            )}
          </div>

          <div data-testid="output-file-preview">
            <div 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                marginBottom: '15px',
                cursor: 'pointer',
                padding: '10px',
                backgroundColor: '#e8f5e9',
                borderRadius: '4px',
                border: '1px solid #81c784'
              }}
              onClick={() => setOutputPreviewExpanded(!outputPreviewExpanded)}
            >
              <div>
                <h3 style={{ margin: 0 }}>Output: {outputPreview.name}</h3>
                <p style={{ color: '#666', margin: '5px 0 0 0', fontSize: '14px' }}>
                  Total rows: <strong>{outputPreview.rows}</strong>
                </p>
              </div>
              <button 
                style={{ 
                  padding: '5px 10px',
                  fontSize: '12px'
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setOutputPreviewExpanded(!outputPreviewExpanded)
                }}
              >
                {outputPreviewExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {outputPreviewExpanded && (
              <div>
                <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '500px', border: '1px solid #ddd' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '14px'
                    }}
                  >
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr style={{ backgroundColor: '#f5f5f5' }}>
                        <th style={{ 
                          padding: '10px', 
                          border: '1px solid #ddd', 
                          textAlign: 'left',
                          fontWeight: 600 
                        }}>
                          #
                        </th>
                        {outputPreview.sample.length > 0 &&
                          Object.keys(outputPreview.sample[0] ?? {}).map((key) => (
                            <th
                              key={key}
                              style={{
                                padding: '10px',
                                border: '1px solid #ddd',
                                textAlign: 'left',
                                fontWeight: 600
                              }}
                            >
                              {key}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {outputPreview.sample.slice(0, 100).map((row, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9f9f9' }}>
                          <td style={{ 
                            padding: '8px', 
                            border: '1px solid #ddd',
                            color: '#999'
                          }}>
                            {idx + 1}
                          </td>
                          {Object.values(row).map((value, colIdx) => (
                            <td
                              key={colIdx}
                              style={{
                                padding: '8px',
                                border: '1px solid #ddd',
                                maxWidth: '200px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {value === null || value === undefined
                                ? <span style={{ color: '#ccc' }}>null</span>
                                : String(value)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p style={{ color: '#666', marginTop: '15px', fontSize: '14px' }}>
                  Showing first {Math.min(outputPreview.sample.length, 100)} of {outputPreview.rows} rows
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
