#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { UsageError } from './args.ts'
import { StoreApiError } from './client.ts'
import { api } from './commands/api.ts'
import { login, logout, whoami } from './commands/auth.ts'
import { media } from './commands/media.ts'
import { runResource } from './commands/resource.ts'
import { createContext, type Env } from './context.ts'
import { HELP } from './help.ts'
import { terminalIo, type Io } from './io.ts'
import { formatTable } from './output.ts'
import { findResource, RESOURCES } from './resources.ts'
import { configDir, FileSessionStore } from './session.ts'
import type { SessionStore } from './client.ts'

export interface MainDeps {
  io: Io
  env: Env
  cwd: string
  store: SessionStore
  fetch?: typeof fetch
}

function version(): string {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  } catch {
    return 'unknown'
  }
}

/** Runs one command line. Returns the exit code: 0 done, 1 failed, 2 wrong usage. */
export async function main(argv: string[], deps: MainDeps): Promise<number> {
  const ctx = createContext(deps.io, deps.env, deps.cwd, deps.store, deps.fetch)
  const [command, ...rest] = argv
  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      ctx.io.stdout(HELP.root)
      return 0
    }
    if (command === '--version' || command === '-v') {
      ctx.io.stdout(`${version()}\n`)
      return 0
    }
    switch (command) {
      case 'login':
        return await login(rest, ctx)
      case 'logout':
        return await logout(rest, ctx)
      case 'whoami':
        return await whoami(rest, ctx)
      case 'api':
        return await api(rest, ctx)
      case 'media':
        return await media(rest, ctx)
      case 'resources':
        ctx.io.stdout(formatTable(RESOURCES.map((r) => ({ name: r.name, endpoint: r.path, find_by: r.lookup?.field ?? 'id', owner_only: r.adminOnly ? 'yes' : '' })), ['name', 'endpoint', 'find_by', 'owner_only']))
        return 0
      default: {
        const resource = findResource(command)
        if (!resource) throw new UsageError(`Unknown command "${command}". Run: spectra --help`)
        return await runResource(resource, rest, ctx)
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.io.stderr(`error: ${error.message}\n`)
      return 2
    }
    if (error instanceof StoreApiError) {
      ctx.io.stderr(`error: ${error.message}${error.status > 0 ? ` (HTTP ${error.status})` : ''}\n${error.fieldErrors.map((e) => `  ${e}\n`).join('')}`)
      return 1
    }
    ctx.io.stderr(`error: ${(error as Error).message}\n`)
    return 1
  }
}

/** True when this file is the program being run (also through the symlink npm makes for a bin), not an import. */
function isEntryPoint(): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === import.meta.filename
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2), {
    io: terminalIo,
    env: process.env,
    cwd: process.cwd(),
    store: new FileSessionStore(configDir(process.env)),
  })
}
