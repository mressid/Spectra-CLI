import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SESSION } from './testkit.ts'
import { configDir, FileSessionStore } from './session.ts'

describe('FileSessionStore', () => {
  it('saves, loads and removes the session, readable by the user only', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'spectra-')), 'cfg')
    const store = new FileSessionStore(dir)
    expect(await store.load()).toBeNull()
    await store.save(SESSION)
    expect(await store.load()).toEqual(SESSION)
    if (process.platform !== 'win32') expect((await stat(join(dir, 'session.json'))).mode & 0o777).toBe(0o600)
    await store.save(null)
    expect(await store.load()).toBeNull()
  })
})

describe('configDir', () => {
  it('prefers SPECTRA_CONFIG_DIR, then XDG, then APPDATA on Windows, then ~/.config', () => {
    expect(configDir({ SPECTRA_CONFIG_DIR: '/a', XDG_CONFIG_HOME: '/b' }, 'linux', '/home/u')).toBe('/a')
    expect(configDir({ XDG_CONFIG_HOME: '/b' }, 'linux', '/home/u')).toBe(join('/b', 'spectra'))
    expect(configDir({ APPDATA: 'C:\\Users\\u\\AppData' }, 'win32', 'C:\\Users\\u')).toBe(join('C:\\Users\\u\\AppData', 'spectra'))
    expect(configDir({}, 'linux', '/home/u')).toBe(join('/home/u', '.config', 'spectra'))
  })
})
