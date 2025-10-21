import type { CredsStore, NtlmCredentials } from './types'

export class InMemoryCredsStore implements CredsStore {
  private store: Map<string, NtlmCredentials> = new Map()

  async save(name: string, creds: NtlmCredentials): Promise<void> {
    this.store.set(name, creds)
  }

  async has(name: string): Promise<boolean> {
    return this.store.has(name)
  }

  async del(name: string): Promise<boolean> {
    return this.store.delete(name)
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  async get(name: string): Promise<NtlmCredentials | null> {
    return this.store.get(name) ?? null
  }

  // Test utility to clear all
  clear(): void {
    this.store.clear()
  }
}

