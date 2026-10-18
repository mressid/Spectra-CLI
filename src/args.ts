import { parseArgs, type ParseArgsConfig } from 'node:util'

/** Wrong command line: shown without a stack trace, exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export const COMMON_OPTIONS = {
  url: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies NonNullable<ParseArgsConfig['options']>

export function parse<const O extends NonNullable<ParseArgsConfig['options']>>(argv: string[], options: O) {
  try {
    return parseArgs({ args: argv, options: { ...COMMON_OPTIONS, ...options }, allowPositionals: true, strict: true })
  } catch (error) {
    throw new UsageError((error as Error).message.replace(/\. To specify a positional.*$/, '.'))
  }
}

/** "a=1" -> ["a", "1"]; used for --filter and --query. */
export function keyValue(text: string, flag: string): [string, string] {
  const at = text.indexOf('=')
  if (at < 1) throw new UsageError(`${flag} expects key=value, got "${text}"`)
  return [text.slice(0, at), text.slice(at + 1)]
}
