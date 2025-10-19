# FlowForge

A secure Electron application built with TypeScript, React, and Vite for data workflow management.

## Security Features

- **Context Isolation**: Enabled (`contextIsolation: true`)
- **Sandbox**: Enabled (`sandbox: true`)
- **Node Integration**: Disabled (`nodeIntegration: false`)
- **Remote Module**: Disabled (`enableRemoteModule: false`)
- **Strong CSP**: Content Security Policy restricts script sources to `'self'`
- **Typed IPC Bridge**: Only predefined IPC channels are exposed to renderer

## Architecture

```
/app
├── main/           # Electron main process
│   ├── main.ts     # Application entry point
│   ├── ipc.ts      # IPC handlers with Zod validation
│   └── security.ts # Security configuration
├── preload/        # Preload scripts
│   ├── preload.ts  # IPC bridge exposure
│   └── types.ts    # Type definitions
└── renderer/       # React renderer process
    ├── index.html  # HTML with CSP
    ├── main.tsx    # React entry point
    ├── App.tsx     # Main component with IPC calls
    └── styles.css  # Basic styling
```

## IPC API

All IPC calls are versioned under `ipc/v1` and return deterministic stub values:

- `listConnections()` → `Promise<Connection[]>` (returns `[]`)
- `saveConnection(connection)` → `Promise<void>` (no-op)
- `deleteConnection(name)` → `Promise<void>` (no-op)
- `testConnection(args)` → `Promise<{ok: boolean}>` (returns `{ok: true}`)
- `selectFile(accept?)` → `Promise<string>` (returns fake path)
- `runWorkflow()` → `Promise<RunWorkflowResponse>` (returns placeholders)
- `openPath(path)` → `Promise<void>` (no-op)

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
- `test`: Placeholder for unit tests
- `test:e2e`: Placeholder for E2E tests
- `golden`: Placeholder for golden tests

## Type Safety

- Strict TypeScript configuration with `noUncheckedIndexedAccess`
- Zod schemas for runtime type validation on all IPC calls
- Fully typed IPC bridge exposed to renderer

## Testing the App

The renderer includes three test buttons that call IPC methods and display JSON results:

1. **List Connections**: Shows empty array `[]`
2. **Test Connection**: Shows `{ok: true}`
3. **Run Workflow**: Shows placeholder workflow results

All IPC calls are reachable and return the expected stub values.
