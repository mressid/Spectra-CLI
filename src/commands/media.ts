import { mkdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse, UsageError } from '../args.ts'
import type { Context } from '../context.ts'
import type { Client } from '../client.ts'
import { dropFolder, type BindingResult, type FileResult } from '../media/drop.ts'
import { isPortableName, type Binding } from '../media/folder.ts'
import { formatJson, formatTable } from '../output.ts'
import { listAll } from '../resources.ts'
import { HELP } from '../help.ts'
import { help } from './auth.ts'

const SUBCOMMANDS = ['upload', 'drop', 'bind', 'waiting', 'skeleton', 'cleanup'] as const

export async function media(argv: string[], ctx: Context): Promise<number> {
  const [sub, ...rest] = argv
  if (!sub || sub === '--help' || sub === '-h') return help(ctx, HELP.media)
  switch (sub) {
    case 'upload':
      return upload(rest, ctx)
    case 'drop':
      return drop(rest, ctx)
    case 'bind':
      return bind(rest, ctx)
    case 'waiting':
      return waiting(rest, ctx)
    case 'skeleton':
      return skeleton(rest, ctx)
    case 'cleanup':
      return cleanup(rest, ctx)
    default:
      throw new UsageError(`Unknown media command "${sub}" (use ${SUBCOMMANDS.join(', ')})`)
  }
}

async function upload(argv: string[], ctx: Context): Promise<number> {
  const { values, positionals } = parse(argv, {})
  if (values.help) return help(ctx, HELP.mediaUpload)
  if (positionals.length === 0) throw new UsageError('Usage: spectra media upload <file>...')
  const client = await ctx.client(values.url)
  const rows: Record<string, unknown>[] = []
  let failed = 0
  for (const file of positionals) {
    try {
      const uploaded = await client.upload(resolve(ctx.cwd, file))
      rows.push({ file, id: uploaded.id, duplicate: uploaded.duplicate, size: uploaded.sizeBytes, url: uploaded.url })
    } catch (error) {
      failed++
      ctx.io.stderr(`${file}: ${(error as Error).message}\n`)
    }
  }
  ctx.io.stdout(values.json ? formatJson(rows) : formatTable(rows, ['file', 'id', 'duplicate', 'size', 'url']))
  return failed > 0 ? 1 : 0
}

const label = (b: { target: string; name: string; role: string; order: number }) => `${b.target}:${b.name} ${b.role} #${b.order}`

async function drop(argv: string[], ctx: Context): Promise<number> {
  const { values, positionals } = parse(argv, { 'dry-run': { type: 'boolean' }, concurrency: { type: 'string' } })
  if (values.help) return help(ctx, HELP.mediaDrop)
  const [dir] = positionals
  if (!dir) throw new UsageError('Usage: spectra media drop <folder> [--dry-run]')
  const root = resolve(ctx.cwd, dir)
  if (!(await stat(root).catch(() => null))?.isDirectory()) throw new UsageError(`${dir} is not a folder`)
  const concurrency = Number(values.concurrency ?? 3)
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new UsageError('--concurrency must be a number from 1 to 10')

  const dryRun = Boolean(values['dry-run'])
  // a dry run never contacts the store: it needs no login
  const client = await ctx.client(values.url)
  const progress = (result: FileResult) => {
    if (values.json) return
    if (result.skipped) ctx.io.stdout(`skip  ${result.relPath}: ${result.error}\n`)
    else if (!result.ok) ctx.io.stdout(`FAIL  ${result.relPath}: ${result.error}\n`)
    else ctx.io.stdout(`ok    ${result.relPath}${result.duplicate ? ' (already in the store)' : ''}\n${result.results.map((b) => `        ${label(b)} ${b.status}\n`).join('')}`)
  }
  const report = await dropFolder(client, root, { dryRun, concurrency, onFile: dryRun ? undefined : progress })

  if (dryRun && !values.json) {
    for (const file of report.plan.files) {
      if (file.problems.length > 0) ctx.io.stdout(`skip  ${file.relPath}: ${file.problems.join('; ')}\n`)
      else ctx.io.stdout(`plan  ${file.relPath}${file.aspectRatio ? ` [${file.aspectRatio}]` : ''}\n${file.bindings.map((b: Binding) => `        ${label(b)}\n`).join('')}`)
    }
  }
  for (const warning of report.plan.warnings) ctx.io.stderr(`warning: ${warning}\n`)
  if (values.json) {
    ctx.io.stdout(formatJson({ dryRun, files: dryRun ? report.plan.files : report.results, warnings: report.plan.warnings, ignored: report.plan.ignored }))
  } else {
    if (report.plan.ignored.length > 0) ctx.io.stderr(`ignored ${report.plan.ignored.length} file(s) that are not an image or video the store accepts\n`)
    const sent = report.plan.files.length - report.skipped
    ctx.io.stdout(
      dryRun
        ? `\n${sent} file(s) ready, ${report.skipped} skipped. Nothing was sent (dry run).\n`
        : `\n${sent - report.failed} of ${report.plan.files.length} file(s) uploaded: ${report.applied} binding(s) applied now, ${report.waiting} waiting for their product/variant/category/brand to be created` +
          `${report.failed ? `, ${report.failed} failed` : ''}${report.skipped ? `, ${report.skipped} skipped` : ''}.\n`,
    )
  }
  return report.failed > 0 || report.skipped > 0 ? 1 : 0
}

/** `product:ring-a`, `product:ring-a:GALLERY`, `product:ring-a:GALLERY:2` */
function parseTarget(spec: string, alt: string | undefined): Binding {
  const [target = '', name = '', role, order] = spec.split(':')
  if (!target || !name) throw new UsageError(`--to expects kind:name[:role[:order]], got "${spec}"`)
  const upperRole = (role ?? (target === 'category' || target === 'brand' ? 'THUMBNAIL' : 'GALLERY')).toUpperCase()
  if (upperRole !== 'THUMBNAIL' && upperRole !== 'GALLERY') throw new UsageError(`The role must be THUMBNAIL or GALLERY, got "${role}"`)
  const position = order === undefined ? 1 : Number(order)
  if (!Number.isInteger(position) || position < 1) throw new UsageError(`The order must be a whole number from 1, got "${order}"`)
  return { target: target.toLowerCase(), name, role: upperRole, order: position, altText: alt }
}

async function bind(argv: string[], ctx: Context): Promise<number> {
  const { values, positionals } = parse(argv, { to: { type: 'string', multiple: true }, alt: { type: 'string' } })
  if (values.help) return help(ctx, HELP.mediaBind)
  const [fileId] = positionals
  if (!fileId || !values.to?.length) throw new UsageError('Usage: spectra media bind <uploadedFileId> --to kind:name[:role[:order]] ...')
  const client = await ctx.client(values.url)
  const answer = await client.request<{ results: BindingResult[] }>('PUT', '/api/v1/admin/media/bindings', {
    body: { uploadedFileId: fileId, bindings: values.to.map((spec) => parseTarget(spec, values.alt)) },
  })
  ctx.io.stdout(values.json ? formatJson(answer.results) : formatTable(answer.results as unknown as Record<string, unknown>[], ['target', 'name', 'role', 'order', 'status']))
  return 0
}

async function waiting(argv: string[], ctx: Context): Promise<number> {
  const { values } = parse(argv, { target: { type: 'string' } })
  if (values.help) return help(ctx, HELP.mediaWaiting)
  const client = await ctx.client(values.url)
  const rows = await client.request<Record<string, unknown>[]>('GET', '/api/v1/admin/media/bindings/waiting', { query: { target: values.target } })
  if (values.json) ctx.io.stdout(formatJson(rows))
  else ctx.io.stdout(formatTable(rows, ['target', 'name', 'role', 'order', 'url']) || 'No image is waiting for its product, variant, category or brand\n')
  return 0
}

const KINDS = {
  products: { target: 'product', field: 'slug', slots: ['thumbnail', 'gallery'], path: '/api/v1/products' },
  variants: { target: 'variant', field: 'sku', slots: ['gallery'], path: '/api/v1/variants' },
  categories: { target: 'category', field: 'slug', slots: ['thumbnail'], path: '/api/v1/categories' },
  brands: { target: 'brand', field: 'slug', slots: ['thumbnail'], path: '/api/v1/brands' },
} as const

/** Empty folders named after what is in the store, to fill with photos and then `media drop`. */
async function skeleton(argv: string[], ctx: Context): Promise<number> {
  const { values, positionals } = parse(argv, { kind: { type: 'string' } })
  if (values.help) return help(ctx, HELP.mediaSkeleton)
  const [dir] = positionals
  if (!dir) throw new UsageError('Usage: spectra media skeleton <folder> [--kind products,variants,categories,brands]')
  const kinds = (values.kind ?? 'products,variants,categories,brands').split(',').map((k) => k.trim())
  const unknown = kinds.filter((k) => !(k in KINDS))
  if (unknown.length > 0) throw new UsageError(`Unknown kind ${unknown.join(', ')} (use ${Object.keys(KINDS).join(', ')})`)

  const client: Client = await ctx.client(values.url)
  const root = resolve(ctx.cwd, dir)
  let created = 0
  const skipped: string[] = []
  const seen = new Map<string, string>()
  for (const kind of kinds as (keyof typeof KINDS)[]) {
    const spec = KINDS[kind]
    for (const row of await listAll<Record<string, unknown>>(client, spec.path)) {
      const name = row[spec.field]
      if (typeof name !== 'string') continue
      const key = `${spec.target}/${name.toLowerCase()}`
      if (!isPortableName(name) || (seen.has(key) && seen.get(key) !== name)) {
        skipped.push(`${spec.target}: ${name}`)
        continue
      }
      seen.set(key, name)
      for (const slot of spec.slots) {
        await mkdir(join(root, spec.target, name, slot), { recursive: true })
        created++
      }
    }
  }
  ctx.io.stdout(`Created ${created} folder(s) in ${root}\n`)
  if (skipped.length > 0) ctx.io.stderr(`Skipped (not a valid folder name on every OS, or the same as another one apart from case): ${skipped.join(', ')}\n`)
  return 0
}

async function cleanup(argv: string[], ctx: Context): Promise<number> {
  const { values } = parse(argv, { apply: { type: 'boolean' } })
  if (values.help) return help(ctx, HELP.mediaCleanup)
  const client = await ctx.client(values.url)
  const result = await client.request<{ dryRun: boolean; scannedFiles: number; unusedFiles: string[]; unusedBytes: number; deletedFiles: number }>('POST', '/api/v1/admin/uploads/cleanup', { query: { dryRun: !values.apply } })
  if (values.json) ctx.io.stdout(formatJson(result))
  else {
    ctx.io.stdout(
      result.dryRun
        ? `${result.unusedFiles.length} of ${result.scannedFiles} stored file(s) are unused (${result.unusedBytes} bytes). Nothing was deleted: add --apply to delete them.\n`
        : `Deleted ${result.deletedFiles} unused file(s) of ${result.scannedFiles}.\n`,
    )
  }
  return 0
}
