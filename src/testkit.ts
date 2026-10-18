/** Test helpers: a store that answers from handlers, an in-memory login and a terminal that records. Not part of the build. */
import type { Session, SessionStore } from './client.ts'
import type { Io } from './io.ts'

export interface FakeRequest {
  method: string
  url: URL
  headers: Headers
  /** Parsed JSON, a FormData for an upload, or undefined. */
  body: unknown
}

export interface FakeReply {
  status?: number
  data?: unknown
  message?: string
  errors?: string[]
}

export type Handler = (request: FakeRequest) => FakeReply | Promise<FakeReply>

/** Routes are keyed "METHOD /path". An unknown route answers 404 like the store does. */
export function fakeStore(routes: Record<string, Handler>) {
  const calls: FakeRequest[] = []
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body
    const request: FakeRequest = { method, url, headers: new Headers(init?.headers), body }
    calls.push(request)
    const handler = routes[`${method} ${url.pathname}`]
    const reply: FakeReply = handler ? await handler(request) : { status: 404, message: `No static resource ${url.pathname}` }
    const status = reply.status ?? 200
    if (status === 204) return new Response(null, { status })
    return new Response(JSON.stringify({ success: status < 400, statusCode: status, data: reply.data ?? null, message: reply.message ?? '', errors: reply.errors ?? [] }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { fetch: impl as typeof fetch, calls }
}

export function memoryStore(initial: Session | null = null): SessionStore & { current: Session | null } {
  const store = {
    current: initial,
    async load() {
      return store.current
    },
    async save(session: Session | null) {
      store.current = session
    },
  }
  return store
}

export function testIo(options: { stdin?: string; answers?: string[]; interactive?: boolean } = {}) {
  const out: string[] = []
  const err: string[] = []
  const answers = [...(options.answers ?? [])]
  const io: Io = {
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    readStdin: async () => options.stdin ?? '',
    prompt: async () => answers.shift() ?? '',
    interactive: options.interactive ?? false,
  }
  return { io, stdout: () => out.join(''), stderr: () => err.join('') }
}

export const SESSION: Session = { baseUrl: 'http://store.test', accessToken: 'token-1', refreshToken: 'refresh-1', userEmail: 'admin@store.test' }
