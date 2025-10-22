// Connection registry to track all connections (with or without credentials)

const connectionRegistry = new Set<string>()

export function registerConnection(name: string): void {
  connectionRegistry.add(name)
}

export function unregisterConnection(name: string): void {
  connectionRegistry.delete(name)
}

export function listConnections(): string[] {
  return Array.from(connectionRegistry)
}

