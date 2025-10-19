# Building FlowForge for Distribution

This guide explains how to create an installable package for end users.

## Prerequisites

1. Install electron-builder:
```bash
npm install
```

## Build Commands

### Quick Test Build (Unpacked)
Creates an unpacked directory you can test without creating an installer:
```bash
npm run package
```
Output: `dist/win-unpacked/FlowForge.exe`

### Full Distribution Build
Creates installer + portable versions:
```bash
npm run dist:win
```

Output files in `dist/`:
- `FlowForge Setup X.X.X.exe` - Full installer (NSIS)
- `FlowForge X.X.X.exe` - Portable version (no install required)

## What Gets Built

### NSIS Installer Features
- User can choose installation directory
- Creates desktop shortcut
- Creates Start Menu shortcut
- Includes uninstaller
- Stores credentials securely in Windows Credential Manager

### Portable Version
- Single executable
- No installation required
- Can run from USB drive
- Still uses Windows Credential Manager for secure storage

## Icon Customization

To use a custom icon:
1. Create or obtain a 256x256 PNG icon
2. Convert to .ico format (use https://convertio.co/png-ico/ or similar)
3. Save as `build/icon.ico`
4. Rebuild

## Build Configuration

Configuration is in `package.json` under the `"build"` section:

```json
{
  "build": {
    "appId": "com.flowforge.app",
    "productName": "FlowForge",
    "win": {
      "target": ["nsis", "portable"]
    }
  }
}
```

## File Size

Expected installer size: ~150-200 MB (includes Chromium, Node.js, and all dependencies)

## Testing the Built App

### Test Unpacked Build
```bash
npm run package
cd dist/win-unpacked
"FlowForge.exe"
```

### Test Installer
1. Run `npm run dist:win`
2. Run `dist/FlowForge Setup X.X.X.exe`
3. Follow installation wizard
4. App launches from Start Menu or Desktop

## Troubleshooting

### Native Dependencies (keytar)
The app uses `keytar` for secure credential storage. electron-builder automatically includes the native module.

If you see errors about missing .node files:
- Check that `extraResources` in package.json includes keytar binaries
- Verify node_modules/keytar/build/Release/*.node exists

### NTLM Authentication
The built app will automatically:
- Use Windows integrated authentication (SSO)
- Access Windows Credential Manager for stored credentials
- Handle system proxy settings

### Code Signing (Optional)
For production, sign the installer with a code signing certificate:

```json
{
  "build": {
    "win": {
      "certificateFile": "path/to/cert.pfx",
      "certificatePassword": "password"
    }
  }
}
```

## Distribution

### Internal Distribution
- Host the installer on a network share
- Users double-click to install
- App auto-updates via Electron's built-in updater

### End User Install Process
1. Download/copy `FlowForge Setup X.X.X.exe`
2. Run installer (Windows SmartScreen may appear if unsigned)
3. Choose installation directory
4. Complete wizard
5. Launch from Desktop shortcut
6. Create connections (Windows integrated auth works automatically!)

## Version Bumping

Update version in `package.json`:
```json
{
  "version": "1.0.1"
}
```

Then rebuild. The installer filename will reflect the new version.

