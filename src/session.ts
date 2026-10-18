/** Where the login is kept: a file in the user's config directory, readable by the user only. */
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Session, SessionStore } from './client.ts'

/** SPECTRA_CONFIG_DIR, else $XDG_CONFIG_HOME/spectra, else %APPDATA%\spectra on Windows, else ~/.config/spectra. */
export function configDir(env: Record<string, string | undefined>, platform: string = process.platform, home: string = homedir()): string {
  if (env.SPECTRA_CONFIG_DIR) return env.SPECTRA_CONFIG_DIR
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'spectra')
  if (platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'spectra')
  return join(home, '.config', 'spectra')
}

export class FileSessionStore implements SessionStore {
  private readonly file: string
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
    this.file = join(dir, 'session.json')
  }

  async load(): Promise<Session | null> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<Session>
      return parsed.accessToken && parsed.baseUrl ? (parsed as Session) : null
    } catch {
      return null
    }
  }

  async save(session: Session | null): Promise<void> {
    if (session === null) {
      await rm(this.file, { force: true })
      return
    }
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    await writeFile(this.file, JSON.stringify(session, null, 2), { mode: 0o600 })
    // writeFile keeps the mode of an existing file: make sure an older, looser one is tightened
    await chmod(this.file, 0o600).catch(() => undefined)
  }
}
