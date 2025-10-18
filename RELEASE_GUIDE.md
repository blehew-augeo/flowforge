# Release Guide - One Command Workflow

## Quick Start

After making changes, run ONE command:

```bash
# 1. Commit your changes first
git add .
git commit -m "Description of changes"

# 2. Release (choose one)
npm run release:patch   # Bug fixes: 1.0.7 -> 1.0.8
npm run release:minor   # New features: 1.0.7 -> 1.1.0
npm run release:major   # Breaking changes: 1.0.7 -> 2.0.0
```

Done! Users will automatically get the update notification when they restart the app.

## What Happens

When you run `npm run release:patch`:

1. Bumps version in `package.json` (e.g., 1.0.7 -> 1.0.8)
2. Creates git tag `v1.0.8`
3. Pushes commit and tag to GitHub
4. GitHub Actions automatically:
   - Builds the app on Windows
   - Creates installer with auto-updater configured
   - Publishes to GitHub Releases with all required files
5. Installed apps check for updates on next launch
6. Users see "Update Available" dialog
7. Update downloads and installs on restart

## First-Time Setup (Already Done!)

Your repo is configured:
- Repository: `blehew-augeo/flowforge`
- GitHub Actions workflow: `.github/workflows/release.yml`
- Auto-updater enabled in `app/main/main.ts`
- No manual tokens needed (uses automatic `GITHUB_TOKEN`)

## Monitoring Releases

After running the release command:

1. Go to https://github.com/blehew-augeo/flowforge/actions
2. Watch the "Build and Release" workflow (takes 3-5 minutes)
3. Once complete, release appears at https://github.com/blehew-augeo/flowforge/releases

The release should include:
- `Data Workflow System Setup 1.0.X.exe` - Installer
- `Data Workflow System Setup 1.0.X.exe.blockmap` - Update verification
- `Data Workflow System 1.0.X.exe` - Portable version
- `latest.yml` - Update metadata (critical for auto-update)

## Semantic Versioning

Choose the right release type:

- **Patch** (`npm run release:patch`): Bug fixes, small changes
  - Example: 1.0.7 -> 1.0.8
- **Minor** (`npm run release:minor`): New features, backward compatible
  - Example: 1.0.7 -> 1.1.0
- **Major** (`npm run release:major`): Breaking changes
  - Example: 1.0.7 -> 2.0.0

## Testing Updates Locally

To test the update flow:

1. Install current version (e.g., v1.0.7)
2. Release new version (e.g., v1.0.8)
3. Wait for GitHub Actions to complete
4. Launch the installed v1.0.7 app
5. After 3 seconds, check logs at:
   - `%AppData%/Data Workflow System/logs/main.log`
   - Look for `[UPDATE]` messages
6. Should see "Update available: 1.0.8" dialog

## Troubleshooting

**No update prompt appears:**
- Check logs: `%AppData%/Data Workflow System/logs/main.log`
- Verify release is marked as "Production" (not pre-release) on GitHub
- Confirm `latest.yml` exists in the release assets
- Ensure installed version is lower than release version

**GitHub Actions fails:**
- Check the Actions tab for error details
- Common causes:
  - Build errors (fix in code)
  - Test failures (fix tests or skip with `--no-verify`)

**Update downloads but won't install:**
- Make sure user installed via Setup.exe (not portable)
- Check if antivirus is blocking the installer
- Try running app as administrator

## Logs Location

Update logs are written to:
- Windows: `%AppData%/Data Workflow System/logs/main.log`

Look for lines starting with `[UPDATE]` to see update check status.

## Advanced: Manual Publishing

If you need to build locally instead of using GitHub Actions:

```bash
# Requires GH_TOKEN environment variable
$env:GH_TOKEN = "your_github_token_here"
npm run publish
```

Not recommended - GitHub Actions provides clean builds in isolated environment.
