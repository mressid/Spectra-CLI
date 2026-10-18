// Builds a standalone executable of the CLI: the program and the Node runtime in one file, so it runs on a machine without Node.
//   npm run build:exe   ->  dist/bin/spectra-<platform>-<arch>[.exe]
// 1. esbuild bundles src/cli.ts (and everything it imports) into one CommonJS file: a Node single executable application
//    (https://nodejs.org/api/single-executable-applications.html) starts from exactly one script.
// 2. `node --build-sea` copies this Node binary and injects the bundle into it.
// The executable is for the OS and CPU this runs on (it contains this machine's Node): build on each system you ship to.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const bundle = join(root, 'build', 'spectra.cjs')
const exe = join(root, 'dist', 'bin', `spectra-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`)

rmSync(join(root, 'build'), { recursive: true, force: true })
mkdirSync(dirname(exe), { recursive: true })

await build({
  entryPoints: [join(root, 'src', 'cli.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // there is no package.json beside the executable: the version is baked in (see version() in src/main.ts)
  define: { __SPECTRA_VERSION__: JSON.stringify(version), 'import.meta.url': '"file:///spectra"' },
  logLevel: 'warning',
})

const config = join(root, 'build', 'sea-config.json')
writeFileSync(config, JSON.stringify({ main: bundle, output: exe, disableExperimentalSEAWarning: true }, null, 2))
rmSync(exe, { force: true })
execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' })

// a broken executable must fail the build, not the first user: run it and compare the version it reports
const reported = execFileSync(exe, ['--version'], { encoding: 'utf8', env: { PATH: '' } }).trim()
if (reported !== version) throw new Error(`the executable reports version "${reported}", expected "${version}"`)
console.log(`built ${exe} (${(statSync(exe).size / 1024 / 1024).toFixed(0)} MB, runs without Node)`)
