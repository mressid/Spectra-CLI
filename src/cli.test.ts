import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from './cli.ts'
import { fakeStore, memoryStore, SESSION, testIo, type Handler } from './testkit.ts'

const UUID = '60000000-0000-4000-8000-000000000004'

function run(argv: string[], routes: Record<string, Handler> = {}, options: Parameters<typeof testIo>[0] & { env?: Record<string, string>; cwd?: string; session?: boolean } = {}) {
  const terminal = testIo(options)
  const store = fakeStore(routes)
  const sessions = memoryStore(options.session === false ? null : SESSION)
  const done = main(argv, { io: terminal.io, env: { STORE_API_URL: 'http://store.test', ...options.env }, cwd: options.cwd ?? process.cwd(), store: sessions, fetch: store.fetch })
  return done.then((code) => ({ code, stdout: terminal.stdout(), stderr: terminal.stderr(), calls: store.calls, sessions }))
}

const page = (content: unknown[], totalElements = content.length) => ({ data: { content, page: { number: 0, size: 20, totalElements, totalPages: 1 } } })

describe('general', () => {
  it('prints help, the version and rejects an unknown command with exit code 2', async () => {
    expect((await run([])).stdout).toContain('Usage: spectra <command>')
    expect((await run(['products', '--help'])).stdout).toContain('Endpoint: /api/v1/products')
    expect((await run(['--version'])).stdout).toMatch(/^\d+\.\d+\.\d+/)
    const unknown = await run(['frobnicate'])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('Unknown command "frobnicate"')
  })

  it('lists the resources', async () => {
    const out = (await run(['resources'])).stdout
    expect(out).toContain('products')
    expect(out).toContain('/api/v1/variants')
  })
})

describe('login', () => {
  const routes = { 'POST /api/v1/auth/login': () => ({ data: { accessToken: 'abc', user: { role: 'ADMIN', email: 'owner@store.test' } } }) }

  it('signs in with the email and the password from the environment and saves the session', async () => {
    const result = await run(['login'], routes, { session: false, env: { SPECTRA_EMAIL: 'owner@store.test', SPECTRA_PASSWORD: 'secret' } })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Logged in as owner@store.test on http://store.test')
    expect(result.sessions.current).toMatchObject({ accessToken: 'abc', baseUrl: 'http://store.test' })
    expect(result.calls[0]?.body).toEqual({ email: 'owner@store.test', password: 'secret' })
  })

  it('reads the password from stdin, or asks for it without echo', async () => {
    const piped = await run(['login', '--email', 'owner@store.test', '--password-stdin'], routes, { session: false, stdin: 'from-stdin\nignored' })
    expect(piped.calls[0]?.body).toEqual({ email: 'owner@store.test', password: 'from-stdin' })
    const asked = await run(['login'], routes, { session: false, interactive: true, answers: ['owner@store.test', 'typed'] })
    expect(asked.calls[0]?.body).toEqual({ email: 'owner@store.test', password: 'typed' })
  })

  it('has no way to pass the password as a flag, and needs one when not at a terminal', async () => {
    const flag = await run(['login', '--email', 'a@b.c', '--password', 'x'], routes, { session: false })
    expect(flag.code).toBe(2)
    expect(flag.stderr).toContain("Unknown option '--password'")
    const none = await run(['login', '--email', 'a@b.c'], routes, { session: false })
    expect(none.code).toBe(2)
    expect(none.stderr).toContain('No password')
  })

  it('whoami shows the account, logout forgets the session', async () => {
    const who = await run(['whoami'], { 'GET /api/v1/users/me': () => ({ data: { email: 'owner@store.test', role: 'ADMIN' } }) })
    expect(who.stdout).toBe('owner@store.test (ADMIN) on http://store.test\n')
    const out = await run(['logout'], { 'POST /api/v1/auth/logout': () => ({ status: 204 }) })
    expect(out.sessions.current).toBeNull()
    expect((await run(['whoami'], {}, { session: false })).stderr).toContain('Not logged in')
  })
})

describe('resources', () => {
  it('lists as a table with a footer on stderr, or as json', async () => {
    const routes = { 'GET /api/v1/products': () => page([{ id: UUID, slug: 'gold-ring', name: 'Gold ring', isActive: true, availability: 'IN_STOCK', priceFrom: 320.5 }]) }
    const table = await run(['products', 'list', '--filter', 'isActive=true', '--sort', 'name:desc'], routes)
    expect(table.stdout).toContain('SLUG')
    expect(table.stdout).toContain('gold-ring')
    expect(table.stderr).toContain('1 products in total')
    const query = table.calls[0]?.url.searchParams
    expect(query?.get('isActive')).toBe('true')
    expect(query?.get('sortBy')).toBe('name')
    expect(query?.get('sortDirection')).toBe('DESC')
    expect(JSON.parse((await run(['products', 'list', '--json'], routes)).stdout)).toHaveLength(1)
  })

  it('--all reads every page', async () => {
    const routes = {
      'GET /api/v1/brands': (req: { url: URL }) => {
        const n = Number(req.url.searchParams.get('page'))
        return { data: { content: [{ id: String(n), slug: `b${n}` }], page: { totalPages: 3 } } }
      },
    }
    const result = await run(['brands', 'list', '--all', '--json'], routes)
    expect(JSON.parse(result.stdout).map((b: { slug: string }) => b.slug)).toEqual(['b0', 'b1', 'b2'])
  })

  it('finds a record by slug, and a variant by its exact SKU among those that contain it', async () => {
    const product = await run(['products', 'get', 'gold-ring'], {
      'GET /api/v1/products': () => page([{ id: UUID, slug: 'gold-ring' }, { id: 'other', slug: 'gold-ring-2' }]),
      [`GET /api/v1/products/${UUID}`]: () => ({ data: { id: UUID, name: 'Gold ring' } }),
    })
    expect(JSON.parse(product.stdout).name).toBe('Gold ring')
    const variant = await run(['variants', 'get', 'RING-1'], {
      'GET /api/v1/variants': () => page([{ id: 'v2', sku: 'RING-10' }, { id: 'v1', sku: 'RING-1' }]),
      'GET /api/v1/variants/v1': () => ({ data: { sku: 'RING-1' } }),
    })
    expect(variant.code).toBe(0)
    expect(variant.calls[0]?.url.searchParams.get('skuContains')).toBe('RING-1')
    expect(await run(['variants', 'get', 'NOPE'], { 'GET /api/v1/variants': () => page([]) })).toMatchObject({ code: 1, stderr: 'error: No variant with sku "NOPE"\n' })
    expect((await run(['orders', 'get', 'ORD-1'])).stderr).toContain('found by id only')
  })

  it('creates and updates from --data, --file or stdin, and refuses a body that is not JSON', async () => {
    const routes = {
      'POST /api/v1/brands': (req: { body: unknown }) => ({ status: 201, data: { id: 'b1', ...(req.body as object) } }),
      'GET /api/v1/brands': () => page([{ id: 'b1', slug: 'acme' }]),
      'PUT /api/v1/brands/b1': (req: { body: unknown }) => ({ data: req.body }),
    }
    const created = await run(['brands', 'create', '--data', '{"slug":"acme","name":"Acme"}'], routes)
    expect(JSON.parse(created.stdout)).toMatchObject({ id: 'b1', slug: 'acme' })
    const file = join(await mkdtemp(join(tmpdir(), 'spectra-')), 'b.json')
    await writeFile(file, '{"name":"From file"}')
    expect((await run(['brands', 'create', '--file', file], routes)).calls[0]?.body).toEqual({ name: 'From file' })
    const updated = await run(['brands', 'update', 'acme', '--file', '-'], routes, { stdin: '{"name":"Piped"}' })
    expect(updated.calls.at(-1)).toMatchObject({ method: 'PUT', body: { name: 'Piped' } })
    const bad = await run(['brands', 'create', '--data', '{nope'], routes)
    expect(bad.code).toBe(2)
    expect(bad.stderr).toContain('not valid JSON')
    expect((await run(['brands', 'create'], routes)).stderr).toContain('No body')
  })

  it('asks before deleting, and only deletes without a terminal when told with --yes', async () => {
    const routes = { 'GET /api/v1/brands': () => page([{ id: 'b1', slug: 'acme' }]), 'DELETE /api/v1/brands/b1': () => ({ status: 204 }) }
    const refused = await run(['brands', 'delete', 'acme'], routes)
    expect(refused.code).toBe(2)
    expect(refused.calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect((await run(['brands', 'delete', 'acme', '--yes'], routes)).calls.at(-1)?.method).toBe('DELETE')
    const declined = await run(['brands', 'delete', 'acme'], routes, { interactive: true, answers: ['n'] })
    expect(declined.code).toBe(1)
    expect(declined.calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect((await run(['brands', 'delete', 'acme'], routes, { interactive: true, answers: ['y'] })).stdout).toContain('Deleted brand acme')
  })

  it('shows the store message and the field errors of a refused request, exit code 1', async () => {
    const result = await run(['brands', 'create', '--data', '{}'], { 'POST /api/v1/brands': () => ({ status: 400, message: 'Validation failed', errors: ['name:must not be blank'] }) })
    expect(result.code).toBe(1)
    expect(result.stderr).toBe('error: Validation failed (HTTP 400)\n  name:must not be blank\n')
  })

  it('api calls any endpoint', async () => {
    const result = await run(['api', 'GET', '/api/v1/admin/stock/low', '-q', 'limit=5'], { 'GET /api/v1/admin/stock/low': () => ({ data: [{ sku: 'A' }] }) })
    expect(JSON.parse(result.stdout)).toEqual([{ sku: 'A' }])
    expect(result.calls[0]?.url.searchParams.get('limit')).toBe('5')
    expect((await run(['api', 'GET', 'no-slash'])).code).toBe(2)
  })
})

async function folder(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'spectra-drop-'))
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(join(dir, ...rel.split('/').slice(0, -1)), { recursive: true })
    await writeFile(join(dir, ...rel.split('/')), content)
  }
  return dir
}

describe('media drop', () => {
  const store = () => {
    let n = 0
    return {
      'POST /api/v1/admin/uploads': (req: { body: unknown }) => {
        const name = ((req.body as FormData).get('file') as File).name
        if (name === 'broken.png') return { status: 400, message: 'Not a valid image' }
        return { data: { id: `file-${++n}-${name}`, url: `http://x/${name}`, mediaType: 'IMAGE', duplicate: name === 'dup.png' } }
      },
      'PUT /api/v1/admin/media/bindings': (req: { body: unknown }) => {
        const { bindings } = req.body as { bindings: { target: string; name: string; role: string; order: number }[] }
        return { data: { results: bindings.map((b) => ({ ...b, status: b.name.startsWith('new-') ? 'WAITING' : 'APPLIED' })) } }
      },
    }
  }

  it('uploads every photo once and binds it to the places its path names', async () => {
    const dir = await folder({
      'product/gold-ring/thumbnail/cover.png': 'a',
      'product/gold-ring/gallery/01_side.png': 'b',
      '[new-ring, new-chain]/gallery/02_box.png': 'c',
      'brand/aurum/thumbnail/logo.png': 'd',
      'README.md': 'not a photo',
    })
    const result = await run(['media', 'drop', dir], store())
    expect(result.code).toBe(0)
    const uploads = result.calls.filter((c) => c.url.pathname.endsWith('/uploads'))
    expect(uploads).toHaveLength(4)
    const bindCalls = result.calls.filter((c) => c.url.pathname.endsWith('/bindings'))
    expect(bindCalls).toHaveLength(4)
    const box = bindCalls.map((c) => c.body as { uploadedFileId: string; bindings: unknown[] }).find((b) => b.uploadedFileId.endsWith('02_box.png'))
    expect(box?.bindings).toEqual([
      { target: 'product', name: 'new-ring', role: 'GALLERY', order: 2, altText: 'Box' },
      { target: 'product', name: 'new-chain', role: 'GALLERY', order: 2, altText: 'Box' },
    ])
    expect(result.stdout).toContain('4 of 4 file(s) uploaded: 3 binding(s) applied now, 2 waiting')
    expect(result.stderr).toContain('ignored 1 file(s)')
  })

  it('a dry run sends nothing and needs no login', async () => {
    const dir = await folder({ 'product/a/thumbnail/c.png': 'x', 'variant/SKU/thumbnail/v.png': 'y' })
    const result = await run(['media', 'drop', dir, '--dry-run'], {}, { session: false })
    expect(result.calls).toHaveLength(0)
    expect(result.stdout).toContain('plan  product/a/thumbnail/c.png')
    expect(result.stdout).toContain('a variant has no thumbnail')
    expect(result.stdout).toContain('Nothing was sent (dry run)')
    expect(result.code).toBe(1) // one file would be skipped
  })

  it('carries on after a failure, reports it, and exits 1', async () => {
    const dir = await folder({ 'product/a/gallery/01_ok.png': 'x', 'product/a/gallery/02_broken.png': 'y', 'product/b/thumbnail/dup.png': 'z' })
    // the fake store keys on the uploaded name: name the broken one as the store would reject it
    const routes = store()
    const upload = routes['POST /api/v1/admin/uploads']
    routes['POST /api/v1/admin/uploads'] = (req) => {
      const name = ((req.body as FormData).get('file') as File).name
      return upload({ body: (() => { const f = new FormData(); f.append('file', new Blob(['x']), name === '02_broken.png' ? 'broken.png' : name); return f })() })
    }
    const result = await run(['media', 'drop', dir], routes)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('FAIL  product/a/gallery/02_broken.png: Not a valid image')
    expect(result.stdout).toContain('ok    product/a/gallery/01_ok.png')
    expect(result.stdout).toContain('(already in the store)')
    expect(result.stdout).toContain('2 of 3 file(s) uploaded')
    expect(result.stdout).toContain('1 failed')
  })

  it('refuses a folder that does not exist', async () => {
    const result = await run(['media', 'drop', '/nonexistent-folder-xyz', '--dry-run'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('is not a folder')
  })
})

describe('media (other commands)', () => {
  it('binds an uploaded file to places by kind:name[:role[:order]]', async () => {
    const result = await run(['media', 'bind', 'file-1', '--to', 'product:ring-a:THUMBNAIL', '--to', 'category:rings', '--to', 'variant:SKU-1:gallery:2', '--alt', 'A ring'], {
      'PUT /api/v1/admin/media/bindings': (req) => ({ data: { results: (req.body as { bindings: object[] }).bindings.map((b) => ({ ...b, status: 'WAITING' })) } }),
    })
    expect(result.code).toBe(0)
    expect(result.calls[0]?.body).toEqual({
      uploadedFileId: 'file-1',
      bindings: [
        { target: 'product', name: 'ring-a', role: 'THUMBNAIL', order: 1, altText: 'A ring' },
        { target: 'category', name: 'rings', role: 'THUMBNAIL', order: 1, altText: 'A ring' },
        { target: 'variant', name: 'SKU-1', role: 'GALLERY', order: 2, altText: 'A ring' },
      ],
    })
    expect((await run(['media', 'bind', 'f', '--to', 'product:a:BANNER'])).code).toBe(2)
    expect((await run(['media', 'bind', 'f', '--to', 'justaname'])).code).toBe(2)
  })

  it('lists what waits for its place', async () => {
    const result = await run(['media', 'waiting', '--target', 'variant'], { 'GET /api/v1/admin/media/bindings/waiting': () => ({ data: [{ target: 'variant', name: 'SKU-9', role: 'GALLERY', order: 1, url: 'http://x/a.png' }] }) })
    expect(result.stdout).toContain('SKU-9')
    expect(result.calls[0]?.url.searchParams.get('target')).toBe('variant')
    expect((await run(['media', 'waiting'], { 'GET /api/v1/admin/media/bindings/waiting': () => ({ data: [] }) })).stdout).toContain('No image is waiting')
  })

  it('cleanup lists by default and deletes only with --apply', async () => {
    const routes = { 'POST /api/v1/admin/uploads/cleanup': (req: { url: URL }) => ({ data: { dryRun: req.url.searchParams.get('dryRun') === 'true', scannedFiles: 10, unusedFiles: ['a', 'b'], unusedBytes: 99, deletedFiles: req.url.searchParams.get('dryRun') === 'true' ? 0 : 2 } }) }
    const dry = await run(['media', 'cleanup'], routes)
    expect(dry.stdout).toContain('2 of 10 stored file(s) are unused')
    expect(dry.stdout).toContain('--apply')
    expect((await run(['media', 'cleanup', '--apply'], routes)).stdout).toContain('Deleted 2 unused file(s)')
  })

  it('skeleton makes the folders for what is in the store and skips names that are not valid folder names', async () => {
    const out = join(await mkdtemp(join(tmpdir(), 'spectra-skel-')), 'photos')
    const result = await run(['media', 'skeleton', out, '--kind', 'products,variants,brands'], {
      'GET /api/v1/products': () => page([{ slug: 'ring-a' }, { slug: 'bad/slug' }]),
      'GET /api/v1/variants': () => page([{ sku: 'SKU-1' }, { sku: 'sku-1' }]),
      'GET /api/v1/brands': () => page([{ slug: 'aurum' }]),
    })
    expect(result.code).toBe(0)
    for (const dir of ['product/ring-a/thumbnail', 'product/ring-a/gallery', 'variant/SKU-1/gallery', 'brand/aurum/thumbnail']) {
      expect((await stat(join(out, ...dir.split('/')))).isDirectory(), dir).toBe(true)
    }
    expect(result.stdout).toContain('Created 4 folder(s)')
    expect(result.stderr).toContain('product: bad/slug')
    expect(result.stderr).toContain('variant: sku-1')
    expect((await run(['media', 'skeleton', out, '--kind', 'widgets'])).code).toBe(2)
  })

  it('upload prints the id and url of each file and exits 1 when one fails', async () => {
    const dir = await folder({ 'a.png': 'a', 'b.png': 'b' })
    const result = await run(['media', 'upload', join(dir, 'a.png'), join(dir, 'b.png')], {
      'POST /api/v1/admin/uploads': (req) => {
        const name = ((req.body as FormData).get('file') as File).name
        return name === 'b.png' ? { status: 413, message: 'Too large' } : { data: { id: 'u1', url: 'http://x/a.png', duplicate: false, sizeBytes: 1 } }
      },
    })
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('u1')
    expect(result.stderr).toContain('b.png: Too large')
  })
})
