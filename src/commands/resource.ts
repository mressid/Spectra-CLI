import { readFile } from 'node:fs/promises'
import { keyValue, parse, UsageError } from '../args.ts'
import type { Context } from '../context.ts'
import { formatJson, formatTable } from '../output.ts'
import { listAll, resolveId, type Page, type Resource } from '../resources.ts'
import { HELP } from '../help.ts'
import { help } from './auth.ts'

const ACTIONS = ['list', 'get', 'create', 'update', 'delete'] as const

/** The JSON body of create / update: --data '{...}', --file body.json, or --file - for stdin. */
export async function readBody(values: { data?: string; file?: string }, ctx: Context): Promise<unknown> {
  if (values.data !== undefined && values.file !== undefined) throw new UsageError('Use --data or --file, not both')
  let text: string
  if (values.data !== undefined) text = values.data
  else if (values.file === '-') text = await ctx.io.readStdin()
  else if (values.file !== undefined) text = await readFile(values.file, 'utf8')
  else throw new UsageError('No body: pass --data \'{"name": "..."}\' or --file body.json (--file - reads stdin)')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new UsageError(`The body is not valid JSON: ${(error as Error).message}`)
  }
}

export async function runResource(resource: Resource, argv: string[], ctx: Context): Promise<number> {
  const [action, ...rest] = argv
  if (!action || action === '--help' || action === '-h') return help(ctx, HELP.resource(resource))
  if (!(ACTIONS as readonly string[]).includes(action)) throw new UsageError(`Unknown action "${action}" for ${resource.name} (use ${ACTIONS.join(', ')})`)

  const { values, positionals } = parse(rest, {
    page: { type: 'string' },
    size: { type: 'string' },
    all: { type: 'boolean' },
    filter: { type: 'string', multiple: true },
    sort: { type: 'string' },
    columns: { type: 'string' },
    data: { type: 'string' },
    file: { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
  })
  if (values.help) return help(ctx, HELP.resource(resource))
  const client = await ctx.client(values.url)
  const ref = positionals[0]
  const needRef = () => {
    if (!ref) throw new UsageError(`${action} needs ${resource.lookup ? `the ${resource.lookup.field} or id` : 'the id'}: spectra ${resource.name} ${action} <ref>`)
    return ref
  }

  switch (action) {
    case 'list': {
      const query: Record<string, string | number | boolean | undefined> = {}
      for (const pair of values.filter ?? []) {
        const [key, value] = keyValue(pair, '--filter')
        query[key] = value
      }
      if (values.sort) {
        const [field, direction] = values.sort.split(':')
        query.sortBy = field
        query.sortDirection = (direction ?? 'asc').toUpperCase()
      }
      let rows: Record<string, unknown>[]
      let footer = ''
      if (values.all) {
        rows = await listAll<Record<string, unknown>>(client, resource.path, query)
        footer = `${rows.length} ${resource.name}\n`
      } else {
        const page = await client.request<Page<Record<string, unknown>>>('GET', resource.path, { query: { ...query, page: values.page ?? 0, size: values.size ?? 20 } })
        rows = page.content ?? []
        const info = page.page
        footer = `page ${(info?.number ?? 0) + 1} of ${info?.totalPages ?? 1}, ${info?.totalElements ?? rows.length} ${resource.name} in total (--page N, --size N, --all)\n`
      }
      if (values.json) ctx.io.stdout(formatJson(rows))
      else {
        ctx.io.stdout(formatTable(rows, values.columns ? values.columns.split(',').map((c) => c.trim()) : resource.columns) || `No ${resource.name}\n`)
        ctx.io.stderr(footer)
      }
      return 0
    }
    case 'get': {
      ctx.io.stdout(formatJson(await client.request('GET', `${resource.path}/${await resolveId(client, resource, needRef())}`)))
      return 0
    }
    case 'create': {
      ctx.io.stdout(formatJson(await client.request('POST', resource.path, { body: await readBody(values, ctx) })))
      return 0
    }
    case 'update': {
      const id = await resolveId(client, resource, needRef())
      ctx.io.stdout(formatJson(await client.request('PUT', `${resource.path}/${id}`, { body: await readBody(values, ctx) })))
      return 0
    }
    default: {
      const id = await resolveId(client, resource, needRef())
      if (!values.yes) {
        if (!ctx.io.interactive) throw new UsageError('Refusing to delete without confirmation: pass --yes')
        const answer = await ctx.io.prompt(`Delete ${resource.name.replace(/s$/, '')} ${ref} (${id})? [y/N] `)
        if (!/^y(es)?$/i.test(answer.trim())) {
          ctx.io.stderr('Not deleted\n')
          return 1
        }
      }
      await client.request('DELETE', `${resource.path}/${id}`)
      ctx.io.stdout(`Deleted ${resource.name.replace(/s$/, '')} ${ref}\n`)
      return 0
    }
  }
}
