#!/usr/bin/env node
// The program: reads the real terminal, environment and login file, and runs main() (src/main.ts, which the tests call).
import { homedir } from 'node:os'
import { terminalIo } from './io.ts'
import { main } from './main.ts'
import { configDir, FileSessionStore } from './session.ts'

// [node, script, ...args], and the same shape in the single executable: [executable, executable, ...args]
main(process.argv.slice(2), {
  io: terminalIo,
  env: process.env,
  cwd: process.cwd(),
  store: new FileSessionStore(configDir(process.env, process.platform, homedir())),
}).then((code) => {
  process.exitCode = code
})
