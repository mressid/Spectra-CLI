# Instructions for AI assistants

Read README.md, then docs/ARCHITECTURE.md.
Rules: no runtime dependencies without a reason written in the commit message; TypeScript strict, `erasableSyntaxOnly` (no enums,
no parameter properties), imports with the `.ts` extension; commands take their world through `Context`/`Io` and return an exit
code (no `process.exit`, no `process.*` outside `cli.ts` and `io.ts`); every command is tested with `testkit.ts` against a fake
store; never accept a password as a flag and never print a token; messages and field errors of the store are shown as they
are; `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` must pass before you stop; the folder rules in
`src/media/folder.ts` stay in step with the importer's (`folder.test.ts` holds its examples); no AI attribution lines in commits.
