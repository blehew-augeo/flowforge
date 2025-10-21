import keytar from 'keytar'
import type { CredsStore, NtlmCredentials } from './types'

const SERVICE_NAME = 'dws/ntlm'

export class KeytarCredsStore implements CredsStore {
  async save(name: string, creds: NtlmCredentials): Promise<void> {
    const secret = JSON.stringify(creds)
    await keytar.setPassword(SERVICE_NAME, name, secret)
  }

  async has(name: string): Promise<boolean> {
    const password = await keytar.getPassword(SERVICE_NAME, name)
    return password !== null
  }

  async del(name: string): Promise<boolean> {
    return await keytar.deletePassword(SERVICE_NAME, name)
  }

  async list(): Promise<string[]> {
    const credentials = await keytar.findCredentials(SERVICE_NAME)
    return credentials.map(c => c.account)
  }

  async get(name: string): Promise<NtlmCredentials | null> {
    const secret = await keytar.getPassword(SERVICE_NAME, name)
    if (secret === null) {
      return null
    }
    try {
      return JSON.parse(secret) as NtlmCredentials
    } catch {
      return null
    }
  }
}

