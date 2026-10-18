# Architecture

A command line over the store's REST API. No server, no database, no runtime dependency: Node's `fetch`, `parseArgs`
and file APIs. TypeScript run directly by Node during development (`erasableSyntaxOnly`, no enums or parameter
properties), compiled by `tsc` to `dist/` for the installed `spectra` command.

```
argv ─► cli.ts main() ─► command (auth | resource | media | api) ─► Client ─► store API
                                │                                    │
                                └──── Io (stdout, stderr, stdin) ◄───┴── SessionStore (file)
```

`main(argv, deps)` takes everything it touches (terminal, environment, cwd, session store, `fetch`) as arguments and returns the
exit code, so every test runs a real command line against `testkit.ts`'s fake store. Nothing reads `process.*` outside `cli.ts`
and `io.ts`.

## Decisions

* **One generic resource command.** The store's REST resources are uniform (`GET /`, `GET /{id}`, `POST /`, `PUT /{id}`,
  `DELETE /{id}`, paged lists), so `resources.ts` is a table, not a command per resource. A resource that needs more
  (stock, reports, settings) is reached with `spectra api`; add a command only when a call is awkward to write by hand.
* **Names before ids.** `resolveId` turns a slug (SKU for variants) into the UUID through the list endpoint's filter. A variant
  is looked up with `skuContains` and the exact value picked, because the list endpoints silently ignore a filter they do not know.
* **Credentials.** The password is read from a hidden prompt, `SPECTRA_PASSWORD` or stdin, never from a flag. The session file
  is `0600` and records its server: a token is never sent to another address. A 401 triggers one refresh and one retry.
* **Output.** Tables for people, `--json` for scripts, messages on stderr, data on stdout. Exit codes: 0 done, 1 failed (the store's
  message and field errors are printed), 2 wrong command line.
* **Deleting asks.** At a terminal it prompts; in a script it refuses without `--yes`.

## Media drop (`media/folder.ts`, `media/drop.ts`)
The path of each file is turned into bindings (`planDrop`, pure), checked against what the store refuses (`bindingProblem`, the
rules of `CatalogMediaTargets.kt`) and its size limits, then each OK file is uploaded and bound with one
`PUT /admin/media/bindings`. Positions nobody gave are the lowest free ones in path order, so the result does not depend on the
order the file system lists files. Slots claimed twice produce a warning.

The folder rules are the importer's (store-importer `src/upload/mediaFolderParser.ts`, docs/MEDIA_LIBRARY.md) ported to paths;
`folder.test.ts` holds the importer's four example folders as expectations, so the two stay in step. Two intended differences:
the roles are limited to the two the store knows (`logo`, `icon`, `hero` mean THUMBNAIL; `banner`, `swatch` mean GALLERY), and
what the store refuses is reported before upload.

## Out of scope
Importing CSV/JSON/YAML catalogues (that is the importer), interactive prompts beyond login and delete, shell completion,
YAML bodies (JSON only), a config file for several servers.
