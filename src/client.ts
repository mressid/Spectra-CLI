/**
 * Client for the store API (the Spring Boot app). Every answer is { success, statusCode, data, message, errors[] }:
 * `request` returns `data` and turns a failure into a StoreApiError carrying the store's own message.
 * A 401 is retried once after refreshing the access token with the saved refresh token.
 */
import { openAsBlob } from 'node:fs'
import { basename } from 'node:path'

export const DEFAULT_BASE_URL = 'http://localhost:8080'

export class StoreApiError extends Error {
  readonly status: number
  readonly fieldErrors: string[]
  constructor(status: number, message: string, fieldErrors: string[] = []) {
    super(message)
    this.name = 'StoreApiError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

export interface Session {
  /** The server the tokens belong to: a session is never sent to another address. */
  baseUrl: string
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  userEmail?: string
}

export interface SessionStore {
  load(): Promise<Session | null>
  save(session: Session | null): Promise<void>
}

export type Query = Record<string, string | number | boolean | undefined>

export interface RequestOptions {
  query?: Query
  body?: unknown
  /** Send the access token. Default true. */
  auth?: boolean
}

/** What the store answers to an upload (UploadedFileResponseDto, the fields used here). */
export interface UploadedFile {
  id: string
  url: string
  mediaType: 'IMAGE' | 'VIDEO'
  width: number | null
  height: number | null
  sizeBytes: number
  /** This exact file was uploaded before: url is the existing one, nothing new was stored. */
  duplicate: boolean
}

interface Envelope<T> {
  data?: T
  message?: string
  errors?: string[]
}

interface LoginData {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  user: { role: string; email?: string }
}

export interface ClientOptions {
  baseUrl: string
  store: SessionStore
  fetch?: typeof fetch
}

export class Client {
  readonly baseUrl: string
  private readonly store: SessionStore
  private readonly fetchImpl: typeof fetch
  private session: Session | null | undefined

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.store = options.store
    this.fetchImpl = options.fetch ?? fetch
  }

  /** The saved session, if it belongs to this server. */
  async currentSession(): Promise<Session | null> {
    if (this.session === undefined) {
      const saved = await this.store.load()
      this.session = saved && saved.baseUrl.replace(/\/+$/, '') === this.baseUrl ? saved : null
    }
    return this.session
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const send = () =>
      this.send<T>(method, path, options, options.body === undefined ? undefined : JSON.stringify(options.body), options.body === undefined ? {} : { 'Content-Type': 'application/json' })
    return this.withRefresh(options.auth !== false, send)
  }

  /** POST /api/v1/admin/uploads. The store stores identical bytes once and says so (`duplicate`). */
  async upload(filePath: string): Promise<UploadedFile> {
    const send = async () => {
      const form = new FormData()
      form.append('file', await openAsBlob(filePath), basename(filePath))
      return this.send<UploadedFile>('POST', '/api/v1/admin/uploads', {}, form, {})
    }
    return this.withRefresh(true, send)
  }

  async login(email: string, password: string): Promise<Session> {
    const data = await this.request<LoginData>('POST', '/api/v1/auth/login', { body: { email, password }, auth: false })
    if (data.user.role !== 'ADMIN' && data.user.role !== 'STAFF') {
      throw new StoreApiError(403, 'This account cannot manage the store (it needs the ADMIN or STAFF role)')
    }
    const session: Session = {
      baseUrl: this.baseUrl,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      userEmail: data.user.email ?? email,
    }
    await this.store.save(session)
    this.session = session
    return session
  }

  async logout(): Promise<void> {
    const session = await this.currentSession()
    if (session?.refreshToken) {
      // best effort: the local session is removed whatever the server says
      await this.request('POST', '/api/v1/auth/logout', { body: { refreshToken: session.refreshToken }, auth: false }).catch(() => undefined)
    }
    await this.store.save(null)
    this.session = null
  }

  private async withRefresh<T>(auth: boolean, send: () => Promise<T>): Promise<T> {
    try {
      return await send()
    } catch (error) {
      if (!(auth && error instanceof StoreApiError && error.status === 401 && (await this.refresh()))) throw error
      return send()
    }
  }

  private async refresh(): Promise<boolean> {
    const session = await this.currentSession()
    if (!session?.refreshToken) return false
    try {
      const data = await this.send<LoginData>('POST', '/api/v1/auth/refresh', {}, JSON.stringify({ refreshToken: session.refreshToken }), { 'Content-Type': 'application/json' }, false)
      const next: Session = {
        ...session,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? session.refreshToken,
        expiresAt: data.expiresAt,
      }
      await this.store.save(next)
      this.session = next
      return true
    } catch {
      return false
    }
  }

  private async send<T>(method: string, path: string, options: RequestOptions, body: string | FormData | undefined, headers: Record<string, string>, auth = options.auth !== false): Promise<T> {
    const url = new URL(this.baseUrl + path)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const session = auth ? await this.currentSession() : null
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: { ...headers, ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) },
        body,
      })
    } catch (error) {
      throw new StoreApiError(0, `Cannot reach ${this.baseUrl}: ${(error as Error).message}`)
    }
    if (response.status === 204) return undefined as T
    const envelope = (await response.json().catch(() => null)) as Envelope<T> | null
    if (!response.ok) {
      const message = envelope?.message || response.statusText || `HTTP ${response.status}`
      throw new StoreApiError(response.status, response.status === 401 && !session ? `${message} (run: spectra login)` : message, envelope?.errors ?? [])
    }
    return envelope?.data as T
  }
}
