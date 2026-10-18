import { Client, DEFAULT_BASE_URL, type SessionStore } from './client.ts'
import type { Io } from './io.ts'

export type Env = Record<string, string | undefined>

export interface Context {
  io: Io
  env: Env
  cwd: string
  /** A client for `--url`, else STORE_API_URL, else the server of the saved login, else http://localhost:8080. */
  client(url?: string): Promise<Client>
}

export function createContext(io: Io, env: Env, cwd: string, store: SessionStore, fetchImpl?: typeof fetch): Context {
  return {
    io,
    env,
    cwd,
    async client(url) {
      const baseUrl = url ?? env.STORE_API_URL ?? (await store.load())?.baseUrl ?? DEFAULT_BASE_URL
      return new Client({ baseUrl, store, fetch: fetchImpl })
    },
  }
}
