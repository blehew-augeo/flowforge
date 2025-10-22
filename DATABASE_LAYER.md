# Database Layer Documentation

## Overview

FlowForge uses a **ports and adapters** (hexagonal architecture) pattern for data persistence. The application depends on abstract interfaces (ports), not concrete database implementations, making it easy to swap SQLite for DuckDB or another backend in the future.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer Process                     │
│  window.db.appendEvent(), window.db.queryProjection()  │
└────────────────────┬────────────────────────────────────┘
                     │ IPC (contextBridge)
┌────────────────────▼────────────────────────────────────┐
│                     Main Process                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │         IPC Handlers (dbHandlers.ts)            │   │
│  │  Input validation, error handling, logging      │   │
│  └─────────────────┬───────────────────────────────┘   │
│                    │                                     │
│  ┌─────────────────▼───────────────────────────────┐   │
│  │     Database Ports (ports.ts - interfaces)      │   │
│  │  EventStorePort, ProjectionStorePort, TxPort    │   │
│  └─────────────────┬───────────────────────────────┘   │
│                    │                                     │
│  ┌─────────────────▼───────────────────────────────┐   │
│  │    SQLite Adapter (sqliteAdapter.ts)            │   │
│  │  Implements ports using better-sqlite3          │   │
│  └─────────────────┬───────────────────────────────┘   │
│                    │                                     │
│  ┌─────────────────▼───────────────────────────────┐   │
│  │          SQLite Database File                   │   │
│  │  ~/AppData/Roaming/flowforge/flowforge.db       │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## File Structure

```
/app/main/db/
├── ports.ts              # Port interfaces (EventStorePort, ProjectionStorePort, etc.)
├── sqliteAdapter.ts      # SQLite implementation using better-sqlite3
├── schema.sql            # Complete database schema
└── index.ts              # Exports dbContext singleton

/app/main/ipc/
└── dbHandlers.ts         # IPC handlers for database operations

/app/preload/
└── db.ts                 # Preload bindings exposing typed db API to renderer
```

## Database Schema

The schema follows an **event-sourced** design with rich workflow orchestration capabilities:

### 1. Event Store (Source of Truth)

**`events`** - Immutable event log
- `id`: Unique event ID
- `aggregate_type`: Type of aggregate (e.g., 'workflow', 'run')
- `aggregate_id`: ID of the aggregate instance
- `event_type`: Type of event (e.g., 'WorkflowCreated', 'RunStarted')
- `event_version`: Event schema version
- `seq`: Sequence number within aggregate
- `tx_id`: Transaction ID for grouping related events
- `caused_by_event_id`: Event causality chain
- `payload_json`: Event data as JSON
- `metadata_json`: Optional metadata (user, timestamp, etc.)
- `created_at`: Event creation timestamp

**`snapshots`** - Aggregate state snapshots for performance
- `id`: Snapshot ID
- `aggregate_type`: Type of aggregate
- `aggregate_id`: Aggregate instance ID
- `last_seq`: Last event sequence included in snapshot
- `state_json`: Complete aggregate state as JSON
- `created_at`: Snapshot creation timestamp

### 2. Catalog (Data Sources & Connectors)

- **`schemas`**: Data schema definitions (name, version, JSON schema)
- **`data_sources`**: File/HTTP/DB sources with configuration
- **`auth_profiles`**: Authentication configurations (NTLM, OAuth2, API keys)
- **`endpoints`**: HTTP endpoints with auth and default headers

### 3. Workflow Definitions

- **`workflows`**: Workflow metadata (name, description)
- **`workflow_versions`**: Versioned workflow definitions (draft/active/archived)
- **`nodes`**: DAG nodes (source, transform, join, rule, http, branch, sink)
- **`edges`**: DAG edges connecting nodes with optional conditions

### 4. Reusable Components

- **`operators`**: Transform/validation/aggregate/enricher operators
- **`rule_sets`**: Versioned business rules
- **`request_templates`**: HTTP request templates with path/headers/body

### 5. Execution & Observability

- **`runs`**: Workflow execution instances with status and timing
- **`run_steps`**: Individual node execution steps
- **`run_logs`**: Structured logs per run/step (debug/info/warn/error)
- **`artifacts`**: Output artifacts (tables, files, views, metrics)
- **`lineage`**: Data lineage graph (artifact → artifact)
- **`request_executions`**: HTTP request/response audit trail

### 6. Materialized Projections

- **`datasets`**: Named datasets with location and schema
- **`joins`**: Pre-computed join definitions

### 7. Scheduling & Governance

- **`schedules`**: Cron-based workflow schedules
- **`idempotency_keys`**: Deduplication for exactly-once semantics
- **`principals`**: Users and service accounts
- **`permissions`**: ACL for resources (read/write/execute/admin)

## Port Interfaces

### EventStorePort

```typescript
interface EventStorePort {
  // Append a new event to the event log
  append(event: {
    aggregateId: string          // Format: "type:id" or just "id"
    eventType: string             // e.g., "WorkflowCreated"
    payload: Record<string, unknown>
    metadata?: Record<string, unknown>
  }): Promise<Event>

  // Load events for an aggregate
  load(args: {
    aggregateId: string
    afterSeq?: number            // Load events after this sequence
  }): Promise<Event[]>

  // Get latest snapshot for performance
  latestSnapshot(args: {
    aggregateId: string
  }): Promise<Snapshot | null>

  // Save a snapshot
  saveSnapshot(snapshot: {
    aggregateId: string
    lastSeq: number
    state: Record<string, unknown>
  }): Promise<void>
}
```

### ProjectionStorePort

```typescript
interface ProjectionStorePort {
  // Query read models with SQL
  query(args: {
    sql: string
    params?: unknown[]
  }): Promise<Array<Record<string, unknown>>>

  // Bulk upsert into projection tables
  upsert(args: {
    table: string
    rows: Array<Record<string, unknown>>
  }): Promise<void>

  // Clear a projection table
  truncate(args: {
    table: string
  }): Promise<void>
}
```

### TxPort

```typescript
interface TxPort {
  // Run operations in a transaction
  runInTransaction<T>(fn: () => T | Promise<T>): Promise<T>
}
```

### BlobStorePort

```typescript
interface BlobStorePort {
  put(args: { key: string; data: Buffer; contentType?: string }): Promise<void>
  get(args: { key: string }): Promise<{ data: Buffer; contentType?: string } | null>
  stat(args: { key: string }): Promise<{ size: number; contentType?: string } | null>
}
```

## Usage Examples

### From Renderer (via IPC)

```typescript
// Append an event
const event = await window.db.appendEvent({
  aggregateId: 'workflow:my-workflow-123',
  eventType: 'WorkflowCreated',
  payload: {
    name: 'Data Processing Pipeline',
    description: 'Process user data from CSV'
  },
  metadata: {
    userId: 'john.doe',
    source: 'ui'
  }
})
console.log('Event appended:', event.seq)

// Load events for a workflow
const events = await window.db.loadEvents({
  aggregateId: 'workflow:my-workflow-123'
})

// Query workflows
const workflows = await window.db.queryProjection({
  sql: 'SELECT * FROM workflows WHERE name LIKE ?',
  params: ['%Pipeline%']
})

// Upsert workflow runs
await window.db.upsertProjection({
  table: 'runs',
  rows: [{
    id: 'run-123',
    workflow_version_id: 'wfv-456',
    trigger: 'manual',
    status: 'queued',
    created_at: new Date().toISOString()
  }]
})
```

### From Main Process (direct adapter access)

```typescript
import { dbContext } from './db'

// Use ports directly in main process
async function createWorkflow(name: string) {
  const workflowId = `workflow:${generateId()}`
  
  // Append event
  await dbContext.eventStore.append({
    aggregateId: workflowId,
    eventType: 'WorkflowCreated',
    payload: { name }
  })
  
  // Update projection in same transaction
  await dbContext.tx.runInTransaction(async () => {
    await dbContext.projectionStore.upsert({
      table: 'workflows',
      rows: [{
        id: workflowId,
        name: name,
        created_at: new Date().toISOString()
      }]
    })
  })
  
  return workflowId
}
```

## Aggregate ID Convention

Aggregate IDs should follow the format: `{type}:{id}`

Examples:
- `workflow:wf-abc123`
- `run:run-xyz789`
- `datasource:ds-file-001`

The adapter automatically extracts the type prefix to populate the `aggregate_type` column. If no colon is present, it defaults to `'default'`.

## Event Versioning

Events include an `event_version` field for schema evolution. The adapter currently sets this to `1` by default. When event schemas change:

1. Increment the version number
2. Keep old event handlers for backward compatibility
3. Document schema changes in event type documentation

## Transaction IDs

Each event is assigned a `tx_id` for grouping related events. The current implementation generates a unique ID per event, but you can enhance this to group multiple events in a logical transaction by passing a shared `tx_id` through metadata.

## Snapshots

Snapshots optimize event replay by storing pre-computed aggregate state:

- Save snapshots every N events (e.g., every 100 events)
- Load latest snapshot + events since snapshot
- Rebuild full state much faster than replaying all events

## Switching to DuckDB

To switch from SQLite to DuckDB:

1. Create `/app/main/db/duckdbAdapter.ts` implementing the same ports
2. Update `/app/main/db/index.ts` to use the new adapter
3. No changes needed in IPC handlers or renderer code!

```typescript
// db/index.ts
import { eventStore, projectionStore, tx } from './duckdbAdapter' // Just change import

export const dbContext: DbContext = {
  eventStore,
  projectionStore,
  tx
}
```

## Database Location

The SQLite database is stored at:
- **Windows**: `C:\Users\{username}\AppData\Roaming\flowforge\flowforge.db`
- **macOS**: `~/Library/Application Support/flowforge/flowforge.db`
- **Linux**: `~/.config/flowforge/flowforge.db`

## Initialization

The database is initialized automatically on app startup in `main.ts`:

```typescript
app.whenReady().then(async () => {
  // Initialize database
  initDb() // Runs schema.sql migrations
  
  // Register IPC handlers with db context
  registerIpc({ credsStore, settingsManager, db: dbContext })
  
  // ...
})
```

## Security Considerations

### Input Validation
- All IPC handlers validate input parameters
- SQL injection prevented via parameterized queries
- Table names validated against whitelist pattern: `[a-zA-Z_][a-zA-Z0-9_]*`

### Projection Queries
- Only `SELECT` queries allowed via `queryProjection` IPC
- Main process can run any SQL (trusted code)
- Renderer limited to read-only queries

### Transactions
- Not exposed via IPC (complex to safely expose)
- Use in main process handlers only
- Ensures ACID properties for multi-step operations

## Performance Tips

1. **Use Snapshots**: Save snapshots every 50-100 events to speed up aggregate reconstruction
2. **Batch Upserts**: Use `upsertProjection` with arrays instead of single-row inserts
3. **Index Queries**: Add indexes in `schema.sql` for frequently queried columns
4. **Limit Loaded Events**: Use `afterSeq` parameter to load only recent events
5. **Project Early**: Keep projections up-to-date rather than replaying events on demand

## Testing

Example test for event store:

```typescript
import { eventStore } from './db/sqliteAdapter'

test('append and load events', async () => {
  const aggregateId = 'test:123'
  
  // Append event
  const event = await eventStore.append({
    aggregateId,
    eventType: 'TestEvent',
    payload: { value: 42 }
  })
  
  expect(event.seq).toBe(1)
  
  // Load events
  const events = await eventStore.load({ aggregateId })
  expect(events).toHaveLength(1)
  expect(events[0].payload.value).toBe(42)
})
```

## Future Enhancements

- [ ] Event pub/sub for real-time UI updates
- [ ] Async projections with worker threads
- [ ] Event replay UI for debugging
- [ ] Schema migrations with version tracking
- [ ] Backup/restore utilities
- [ ] DuckDB adapter for analytics workloads
- [ ] Read replicas for scaling queries
- [ ] Event archival to cold storage

