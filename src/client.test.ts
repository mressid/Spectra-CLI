import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client, StoreApiError } from './client.ts'
import { fakeStore, memoryStore, SESSION } from './testkit.ts'

describe('Client', () => {
  it('returns the data of the answer, sends the token and the query', async () => {
    const store = fakeStore({ 'GET /api/v1/brands': () => ({ data: { content: [{ slug: 'a' }] } }) })
    const client = new Client({ baseUrl: 'http://store.test/', store: memoryStore(SESSION), fetch: store.fetch })
    const data = await client.request<{ content: unknown[] }>('GET', '/api/v1/brands', { query: { slug: 'a', page: 0, skip: undefined } })
    expect(data.content).toHaveLength(1)
    const call = store.calls[0]
    expect(call?.headers.get('Authorization')).toBe('Bearer token-1')
    expect(call?.url.search).toBe('?slug=a&page=0')
  })

  it('turns a failure into an error with the store message and field errors', async () => {
    const store = fakeStore({ 'POST /api/v1/brands': () => ({ status: 400, message: 'Validation failed', errors: ['slug:already used'] }) })
    const client = new Client({ baseUrl: 'http://store.test', store: memoryStore(SESSION), fetch: store.fetch })
    const error = await client.request('POST', '/api/v1/brands', { body: {} }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StoreApiError)
    expect(error).toMatchObject({ status: 400, message: 'Validation failed', fieldErrors: ['slug:already used'] })
  })

  it('refreshes the token once on a 401 and retries', async () => {
    let first = true
    const store = fakeStore({
      'GET /api/v1/users/me': (req) => {
        if (req.headers.get('Authorization') === 'Bearer token-1' && first) {
          first = false
          return { status: 401, message: 'expired' }
        }
        return { data: { email: 'a@b.c', seen: req.headers.get('Authorization') } }
      },
      'POST /api/v1/auth/refresh': () => ({ data: { accessToken: 'token-2', refreshToken: 'refresh-2', user: { role: 'ADMIN' } } }),
    })
    const sessions = memoryStore(SESSION)
    const client = new Client({ baseUrl: 'http://store.test', store: sessions, fetch: store.fetch })
    const me = await client.request<{ seen: string }>('GET', '/api/v1/users/me')
    expect(me.seen).toBe('Bearer token-2')
    expect(sessions.current).toMatchObject({ accessToken: 'token-2', refreshToken: 'refresh-2', userEmail: 'admin@store.test' })
    expect(store.calls.map((c) => c.url.pathname)).toEqual(['/api/v1/users/me', '/api/v1/auth/refresh', '/api/v1/users/me'])
  })

  it('points to "spectra login" when there is no session', async () => {
    const store = fakeStore({ 'GET /api/v1/orders': () => ({ status: 401, message: 'Authentication required' }) })
    const client = new Client({ baseUrl: 'http://store.test', store: memoryStore(), fetch: store.fetch })
    await expect(client.request('GET', '/api/v1/orders')).rejects.toThrow('spectra login')
  })

  it('never sends the token of one server to another', async () => {
    const store = fakeStore({ 'GET /api/v1/orders': () => ({ data: [] }) })
    const client = new Client({ baseUrl: 'http://other.test', store: memoryStore(SESSION), fetch: store.fetch })
    await client.request('GET', '/api/v1/orders')
    expect(store.calls[0]?.headers.get('Authorization')).toBeNull()
  })

  it('says so when the server cannot be reached', async () => {
    const client = new Client({ baseUrl: 'http://store.test', store: memoryStore(), fetch: (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch })
    await expect(client.request('GET', '/x', { auth: false })).rejects.toMatchObject({ status: 0, message: expect.stringContaining('Cannot reach http://store.test') })
  })

  it('logs in, keeps the session, and refuses an account that cannot manage the store', async () => {
    const store = fakeStore({
      'POST /api/v1/auth/login': (req) => {
        const { email } = req.body as { email: string }
        return { data: { accessToken: 'abc', refreshToken: 'r', user: { role: email.startsWith('admin') ? 'ADMIN' : 'CUSTOMER', email } } }
      },
    })
    const sessions = memoryStore()
    const client = new Client({ baseUrl: 'http://store.test', store: sessions, fetch: store.fetch })
    await client.login('admin@x.y', 'pw')
    expect(sessions.current).toMatchObject({ baseUrl: 'http://store.test', accessToken: 'abc', userEmail: 'admin@x.y' })
    expect(store.calls[0]?.headers.get('Authorization')).toBeNull()
    await expect(client.login('shopper@x.y', 'pw')).rejects.toThrow('cannot manage the store')
  })

  it('uploads a file as multipart under the name "file"', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spectra-'))
    const file = join(dir, 'ring.png')
    await writeFile(file, 'png-bytes')
    const store = fakeStore({ 'POST /api/v1/admin/uploads': () => ({ data: { id: 'u1', url: 'http://x/u1.png', mediaType: 'IMAGE', duplicate: false } }) })
    const client = new Client({ baseUrl: 'http://store.test', store: memoryStore(SESSION), fetch: store.fetch })
    const uploaded = await client.upload(file)
    expect(uploaded.id).toBe('u1')
    const form = store.calls[0]?.body as FormData
    expect((form.get('file') as File).name).toBe('ring.png')
  })
})
