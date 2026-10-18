import { RESOURCES, type Resource } from './resources.ts'

const GLOBAL = `Global options
  --url <address>   store API address (default: STORE_API_URL, else the server you logged in to, else http://localhost:8080)
  --json            machine-readable output
  -h, --help        help for a command
`

export const HELP = {
  root: `spectra: command line for the store API

Usage: spectra <command> [options]

Account
  login               sign in (the session is kept in ~/.config/spectra, readable by you only)
  logout | whoami

Catalogue and shop (spectra <resource> list|get|create|update|delete)
  ${RESOURCES.map((r) => r.name).join(', ')}
  Records are found by slug (SKU for variants) or id: spectra products get gold-ring

Media
  media drop <folder>     upload a folder of photos and bind each one by its folder path
  media upload | bind | waiting | skeleton | cleanup

Other
  api <METHOD> <path>     any endpoint, with your login
  resources               list the resources above with their columns

${GLOBAL}
Examples
  spectra login --url https://shop.example
  spectra products list --filter isActive=true --sort name
  spectra products update gold-ring --data '{"isActive": false}'
  spectra media drop ./photos --dry-run
`,
  login: `Usage: spectra login [--url <address>] [--email <email>] [--password-stdin]

Signs in with an ADMIN or STAFF account and saves the session. The password is asked for without echo, or read from
the first line of stdin (--password-stdin), or from SPECTRA_PASSWORD; it is never taken from a flag. SPECTRA_EMAIL sets the email.

${GLOBAL}`,
  logout: `Usage: spectra logout\n\nEnds the session on the server and removes the saved one.\n`,
  whoami: `Usage: spectra whoami\n\nShows the account the saved session belongs to.\n`,
  api: `Usage: spectra api <METHOD> <path> [--query k=v]... [--data <json> | --file <file>]

Calls any endpoint with your login and prints the "data" of the answer. --file - reads the body from stdin.
  spectra api GET /api/v1/admin/stock/low
  spectra api PUT /api/v1/store-settings --file settings.json

${GLOBAL}`,
  media: `Usage: spectra media <command>

  drop <folder>       upload every photo of a folder tree and bind it by name; --dry-run shows the plan only
  upload <file>...    upload files and print their id and url
  bind <id> --to ...  put an uploaded file in places by slug/SKU (the places may not exist yet)
  waiting             images bound to a slug/SKU whose product, variant, category or brand is not created yet
  skeleton <folder>   empty folders named after what is in the store, to fill and then drop
  cleanup             list (or --apply: delete) uploaded files nothing uses

${GLOBAL}`,
  mediaUpload: `Usage: spectra media upload <file>...\n\nImages up to 5 MB (JPEG, PNG, WebP, GIF, AVIF), videos up to 50 MB (MP4, WebM). The same bytes are stored once.\n`,
  mediaDrop: `Usage: spectra media drop <folder> [--dry-run] [--concurrency <1-10>]

Uploads every photo and video under <folder> and binds it to the place its path names. The folder itself is not part of
the path. Places that do not exist yet are reserved and filled when they are created, so photos can go first.

  product/<slug>/thumbnail/cover.png        the main image of a product
  product/<slug>/gallery/01_front.png       gallery, position 1 (the number sets the order)
  variant/<sku>/gallery/…                   a variant has a gallery only
  category/<slug>/thumbnail/…               category and brand have one image: thumbnail/
  brand/<slug>/thumbnail/…
  [ring-a, ring-b]/gallery/macro.png        one photo for several products (variant[a, b]/…, [product=a, category=b]/…)
  [ring-a@1, ring-b@3]/gallery/macro.png    a different position per place
  4x5/                                      aspect ratio folder (informational)

Folder names use only characters valid on Windows, macOS and Linux. Roles: THUMBNAIL (thumbnail, cover, main, hero, logo,
icon) and GALLERY (gallery, images, photos, banner, swatch). Files the store would refuse (a variant thumbnail, a category
gallery, a file over the size limit) are skipped and reported. Exit code 1 if anything failed or was skipped.

${GLOBAL}`,
  mediaBind: `Usage: spectra media bind <uploadedFileId> --to <kind:name[:role[:order]]>... [--alt <text>]

  spectra media bind 3f2a… --to product:ring-a:THUMBNAIL --to category:rings
Kinds: product, variant, category, brand. Role defaults to THUMBNAIL for category and brand, else GALLERY; order to 1.

${GLOBAL}`,
  mediaWaiting: `Usage: spectra media waiting [--target product|variant|category|brand]\n\nImages already in the store, bound to a slug or SKU whose record does not exist yet. They are attached when it is created.\n`,
  mediaSkeleton: `Usage: spectra media skeleton <folder> [--kind products,variants,categories,brands]

Creates empty folders (product/<slug>/thumbnail, product/<slug>/gallery, variant/<sku>/gallery, category/<slug>/thumbnail,
brand/<slug>/thumbnail) for what is in the store. Fill them with photos, then: spectra media drop <folder>
`,
  mediaCleanup: `Usage: spectra media cleanup [--apply]\n\nLists the uploaded files nothing uses (older than a day). Owner (ADMIN) only. --apply deletes them.\n`,
  resource: (resource: Resource) => `Usage: spectra ${resource.name} <action> [options]

  list [--page N] [--size N] [--all] [--filter key=value]... [--sort field[:asc|desc]] [--columns a,b]
  get <${resource.lookup ? `${resource.lookup.field} | id` : 'id'}>
  create (--data <json> | --file <file>)        --file - reads stdin
  update <${resource.lookup ? `${resource.lookup.field} | id` : 'id'}> (--data <json> | --file <file>)
  delete <${resource.lookup ? `${resource.lookup.field} | id` : 'id'}> [--yes]

Endpoint: ${resource.path}${resource.adminOnly ? '  (owner only)' : ''}
Columns of list: ${resource.columns.join(', ')}
The fields of a body are in the store's API documentation (/swagger-ui.html).

${GLOBAL}`,
}
