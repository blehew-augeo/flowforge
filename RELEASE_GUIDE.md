# Release and Auto-Update Guide

This guide explains how to release new versions and enable automatic updates for installed apps.

## Prerequisites

1. Push your code to a public GitHub repository
2. Update the `publish` section in `package.json`:
   ```json
   "publish": {
     "provider": "github",
     "owner": "YOUR_GITHUB_USERNAME",
     "repo": "YOUR_REPO_NAME"
   }
   ```

## How Auto-Updates Work

- When the app starts, it checks GitHub Releases for new versions
- If a new version is found, users are prompted to download it
- After download, users can restart to install the update
- Updates are only checked in production builds (not during development)

## Releasing a New Version

### Method 1: Using npm scripts (Recommended)

Bump version and push tag automatically:

```bash
# For a patch release (1.0.0 -> 1.0.1)
npm run release:patch

# For a minor release (1.0.0 -> 1.1.0)
npm run release:minor

# For a major release (1.0.0 -> 2.0.0)
npm run release:major
```

These commands will:
1. Update the version in `package.json`
2. Create a git commit
3. Create a git tag (e.g., `v1.0.1`)
4. Push the commit and tag to GitHub

### Method 2: Manual release

```bash
# Update version in package.json manually or use:
npm version patch  # or minor, or major

# Push the tag
git push --follow-tags
```

## GitHub Actions Workflow

When you push a tag (e.g., `v1.0.1`), the GitHub Actions workflow automatically:

1. Builds the application
2. Creates Windows installers (NSIS and portable)
3. Creates a GitHub Release
4. Uploads the installers to the release

The workflow file is at `.github/workflows/release.yml`

## What Gets Published

For each release, these files are created and uploaded:

- `Data Workflow System Setup X.X.X.exe` - Full installer (NSIS)
- `Data Workflow System X.X.X.exe` - Portable version
- `Data Workflow System Setup X.X.X.exe.blockmap` - For delta updates
- `latest.yml` - Update metadata file (used by auto-updater)

## Testing Auto-Updates

1. Release version 1.0.0:
   ```bash
   npm run release:patch  # or release:minor/major
   ```

2. Install the app using the generated installer

3. Make some changes to your code

4. Release version 1.0.1:
   ```bash
   npm run release:patch
   ```

5. Start the installed app - it should prompt you about the available update

## Update Behavior

- **Check frequency**: On app startup (3 seconds delay)
- **Download**: Manual (user confirms)
- **Install**: Manual (user confirms restart)
- **Auto-install on quit**: Enabled (installs when app is closed if update was downloaded)

## Troubleshooting

### Updates not detected

- Verify the `publish` config in `package.json` has correct owner/repo
- Check that GitHub Release was created successfully
- Ensure the release includes `latest.yml` file
- Check console logs for update errors

### Build fails on GitHub Actions

- Verify all dependencies are in `package.json` (not just `devDependencies`)
- Check that `build/icon.ico` exists in the repository
- Review GitHub Actions logs for specific errors

### Users can't download updates

- Ensure your GitHub repository is public
- Check that release assets are publicly accessible
- Verify users have internet connectivity

## Version Numbering

Follow semantic versioning:
- **Patch** (1.0.X): Bug fixes, minor changes
- **Minor** (1.X.0): New features, backwards compatible
- **Major** (X.0.0): Breaking changes

## Security Notes

- The auto-updater verifies code signatures (if you add code signing)
- Updates are downloaded over HTTPS from GitHub
- Users must confirm before downloading/installing updates
- No automatic silent updates without user consent

## Code Signing (Optional but Recommended)

For production releases, sign your code with a certificate:

1. Obtain a code signing certificate
2. Add to `package.json`:
   ```json
   "win": {
     "certificateFile": "path/to/cert.pfx",
     "certificatePassword": "env:CSC_KEY_PASSWORD"
   }
   ```
3. Set `CSC_KEY_PASSWORD` in GitHub Actions secrets

Signed apps avoid Windows SmartScreen warnings.

