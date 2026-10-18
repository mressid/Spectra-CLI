import { parse, UsageError } from '../args.ts'
import type { Context } from '../context.ts'
import { formatJson } from '../output.ts'
import { HELP } from '../help.ts'

export async function login(argv: string[], ctx: Context): Promise<number> {
  const { values } = parse(argv, { email: { type: 'string' }, 'password-stdin': { type: 'boolean' } })
  if (values.help) return help(ctx, HELP.login)
  const client = await ctx.client(values.url)

  const email = values.email ?? ctx.env.SPECTRA_EMAIL ?? (ctx.io.interactive ? (await ctx.io.prompt('Email: ')).trim() : '')
  if (!email) throw new UsageError('No email: pass --email, set SPECTRA_EMAIL or run in a terminal')

  let password: string | undefined
  if (values['password-stdin']) password = ((await ctx.io.readStdin()).split(/\r?\n/)[0] ?? '').trim()
  else password = ctx.env.SPECTRA_PASSWORD ?? (ctx.io.interactive ? await ctx.io.prompt('Password: ', { hidden: true }) : undefined)
  if (!password) throw new UsageError('No password: pipe it with --password-stdin, set SPECTRA_PASSWORD or run in a terminal (it is never taken from a flag)')

  const session = await client.login(email, password)
  ctx.io.stdout(`Logged in as ${session.userEmail} on ${client.baseUrl}\n`)
  return 0
}

export async function logout(argv: string[], ctx: Context): Promise<number> {
  const { values } = parse(argv, {})
  if (values.help) return help(ctx, HELP.logout)
  const client = await ctx.client(values.url)
  await client.logout()
  ctx.io.stdout('Logged out\n')
  return 0
}

export async function whoami(argv: string[], ctx: Context): Promise<number> {
  const { values } = parse(argv, {})
  if (values.help) return help(ctx, HELP.whoami)
  const client = await ctx.client(values.url)
  if (!(await client.currentSession())) throw new UsageError(`Not logged in to ${client.baseUrl} (run: spectra login)`)
  const me = await client.request<{ email: string; role: string; firstName?: string; lastName?: string }>('GET', '/api/v1/users/me')
  if (values.json) ctx.io.stdout(formatJson({ ...me, baseUrl: client.baseUrl }))
  else ctx.io.stdout(`${me.email} (${me.role}) on ${client.baseUrl}\n`)
  return 0
}

export function help(ctx: Context, text: string): number {
  ctx.io.stdout(text)
  return 0
}
