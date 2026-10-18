# Spectra CLI

A command line for the store API (`accessories-store-system`, Spring Boot): read and change the catalogue, orders and
settings, and **upload a whole folder of photos in one command**, each photo bound to its product, variant, category or
brand by the folder it sits in.

No runtime dependencies. Node 22.18 or newer.

```bash
npm install
npm run build && npm link          # puts `spectra` on your PATH (or: node src/cli.ts <command>)

spectra login --url http://localhost:8080
spectra products list --filter isActive=true --sort name
spectra products get gold-solitaire-ring
spectra products update gold-solitaire-ring --data '{"isActive": false}'
spectra media drop ./photos --dry-run     # the plan, nothing sent
spectra media drop ./photos
```

## Login
`spectra login` asks for the email and the password (not echoed). For scripts: `SPECTRA_EMAIL` and `SPECTRA_PASSWORD`, or
`--password-stdin`. **The password is never taken from a flag** (it would end up in the shell history and the process list).
The session (access and refresh token) is kept in `~/.config/spectra/session.json` (`$XDG_CONFIG_HOME`, `%APPDATA%` on
Windows, or `SPECTRA_CONFIG_DIR`), readable by you only, and is only ever sent to the server it was created for. An expired
token is renewed with the refresh token. The account needs the `ADMIN` or `STAFF` role.

The server is `--url`, else `STORE_API_URL`, else the one you logged in to, else `http://localhost:8080`.

## Resources
`spectra <resource> list | get | create | update | delete`, the same for every resource (`spectra resources` lists them):

```bash
spectra variants list --filter productId=<uuid> --all --json
spectra categories create --file category.json        # or --data '{...}', or --file - for stdin
spectra brands delete acme --yes                      # asks first at a terminal; needs --yes in a script
```

* `get`, `update`, `delete` take the **slug** (the **SKU** for variants) or the id; a name is looked up for you.
* `list` is a table (`--columns a,b` to choose), `--json` for scripts, `--page N --size N` or `--all`, `--sort field[:desc]`,
  `--filter key=value` (any parameter the list endpoint accepts).
* Bodies are JSON; the fields are those of the store's API documentation (`/swagger-ui.html`).
* Failures print the store's own message and its field errors (`slug:already used`) and exit with 1; a wrong command line exits with 2.

Anything else: `spectra api GET /api/v1/admin/stock/low`, `spectra api PUT /api/v1/store-settings --file settings.json`.

## Media: drop a folder
`spectra media drop <folder>` uploads every photo and video under the folder and binds each one to the place its **path**
names. The same folder rules as the importer's Media Library, so a folder made for one works in the other.

```
photos/
├── product/gold-ring/thumbnail/cover.png          main image
├── product/gold-ring/gallery/01_side.png          gallery, position 1 (the number sets the order)
├── variant/RING-52/gallery/01_macro.png           variants have a gallery only
├── category/rings/thumbnail/rings.png             a category and a brand have one image: thumbnail/
├── brand/aurum/thumbnail/logo.png
├── [new-ring, new-chain]/gallery/02_box.png       one photo, several products
└── [gold-ring@1, silver-ring@3]/gallery/macro.png a position per place
```

| Folder name | Means |
|---|---|
| `product/<slug>` `variant/<sku>` `category/<slug>` `brand/<slug>` | the place |
| `thumbnail/` (also `cover`, `main`, `hero`, `logo`, `icon`) | the one main image, position 1 |
| `gallery/` (also `images`, `photos`, `banner`, `swatch`) | one of several; position from `1/`, `order-3/` or the file name (`01_front.png`), else the lowest free one |
| `[a, b]` `variant[x, y]` `[product=a, category=b]` | several places for one photo |
| `[a@1, b@3]` | a position per place |
| `4x5/` | aspect ratio, shown only |

* Folder names use only characters valid on Windows, macOS and Linux. The older `*:[a, b]`, `product:a`, `a:3`, `4:5` still work.
* The **places do not have to exist yet**: a photo bound to a missing slug/SKU is reserved (`WAITING`) and attached when the
  product is created, so photos can go first. `spectra media waiting` lists them.
* The store accepts two roles (thumbnail, gallery). What it would refuse is reported **before** anything is sent and the file is
  skipped: a variant thumbnail, a category or brand gallery, a file over 5 MB (images) or 50 MB (videos).
* The same bytes are stored once; a re-run is harmless (`already in the store`). A failed file does not stop the others.
  Exit code 1 if anything failed or was skipped. Files that are not an image or video the store accepts are ignored.

Other media commands: `media upload <file>...`, `media bind <id> --to product:ring-a:THUMBNAIL`, `media waiting`,
`media cleanup [--apply]`, and `media skeleton <folder>`, which creates the empty folders for what is **in the store**
(then fill them and `media drop` them).

## Develop
```bash
npm test          # client, session, folder rules, every command against a fake store
npm run typecheck && npm run lint
npm run build     # dist/, what the `spectra` command runs
npm run dev -- products list      # runs src/cli.ts directly
```
See [AGENTS.md](AGENTS.md) for the rules and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## Layout
```
src/cli.ts            entry point and command router (main() is what the tests call)
src/client.ts         API client: envelope, errors, token refresh, upload
src/session.ts        the saved login
src/resources.ts      the REST resources, slug/SKU lookup, paging
src/commands/         auth, resource (list/get/create/update/delete), media, api
src/media/folder.ts   folder path -> bindings (the rules above)
src/media/drop.ts     scan, check, upload and bind a folder
src/testkit.ts        fake store, in-memory session, recording terminal (tests only)
```

## As a submodule
Part of the store system next to the storefront (`Spectra`) and the importer (`Spectra-Importer`):
`git submodule update --init Spectra-CLI`.
