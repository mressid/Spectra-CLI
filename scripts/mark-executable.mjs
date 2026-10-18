// the compiled entry point starts with a shebang; npm link / npm i -g need it to be executable
import { chmodSync } from 'node:fs'

chmodSync(new URL('../dist/cli.js', import.meta.url), 0o755)
