# FlowForge

A secure Electron application built with TypeScript, React, and Vite for data workflow management.

## Features

- Built with Electron, React, and TypeScript
- Secure IPC communication between main and renderer processes
- NTLM authentication support for corporate networks
- Excel and CSV file processing
- Auto-update functionality

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production build
npm run start
```

## Scripts

- `dev`: Start development with Vite + Electron hot reload
- `start`: Launch production Electron app
- `build`: Build for production
- `test`: Run unit tests with Vitest
- `test:e2e`: Run end-to-end tests with Playwright
- `dist:win`: Build Windows installer
- `release:patch`: Create a new patch release (bumps version and triggers auto-update)

## Type Safety

- Strict TypeScript configuration with `noUncheckedIndexedAccess`
- Full type safety across main, preload, and renderer processes
- Runtime validation for critical data paths
