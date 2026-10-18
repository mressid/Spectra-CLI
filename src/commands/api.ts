import { keyValue, parse, UsageError } from '../args.ts'
import type { Context } from '../context.ts'
import { formatJson } from '../output.ts'
import { HELP } from '../help.ts'
import { help } from './auth.ts'
import { readBody } from './resource.ts'

/** The escape hatch: any endpoint, with the saved login. Prints `data` of the answer. */
export async function api(argv: string[], ctx: Context): Promise<number> {
  const { values, positionals } = parse(argv, {
    query: { type: 'string', short: 'q', multiple: true },
    data: { type: 'string' },
    file: { type: 'string' },
  })
  if (values.help) return help(ctx, HELP.api)
  const [method, path] = positionals
  if (!method || !path) throw new UsageError('Usage: spectra api <METHOD> <path> [--query k=v] [--data JSON | --file F]')
  if (!path.startsWith('/')) throw new UsageError(`The path must start with "/", got "${path}"`)
  const query: Record<string, string> = {}
  for (const pair of values.query ?? []) {
    const [key, value] = keyValue(pair, '--query')
    query[key] = value
  }
  const hasBody = values.data !== undefined || values.file !== undefined
  const client = await ctx.client(values.url)
  const data = await client.request<unknown>(method.toUpperCase(), path, { query, body: hasBody ? await readBody(values, ctx) : undefined })
  if (data !== undefined) ctx.io.stdout(formatJson(data))
  return 0
}
