/**
 * Turns the path of each photo in a folder into where it goes in the store. The same rules as the importer's
 * "Media Library" (store-importer, docs/MEDIA_LIBRARY.md), on paths instead of browser File objects:
 *
 *   product/<slug>/thumbnail/cover.png          main image of a product
 *   product/<slug>/gallery/01_front.png         gallery, position 1
 *   variant/<sku>/gallery/…   category/<slug>/thumbnail/…   brand/<slug>/thumbnail/…
 *   [ring-a, ring-b]/gallery/macro.png          one photo, several places;  variant[SKU-1, SKU-2]/…;  [product=a, category=b]/…
 *   [ring-a@1, ring-b@3]/gallery/macro.png      a position per place
 *   4x5/ (aspect ratio, informational)          1/  order-3/  01_front.png  (positions)
 *
 * Folder names use only characters valid on Windows, macOS and Linux; the older `*:[a, b]`, `kind:name`, `name:3`
 * spellings are still read. The store knows two roles, THUMBNAIL and GALLERY, so logo/icon/avatar/hero mean THUMBNAIL
 * and banner/header/swatch/color mean GALLERY.
 */

export type Role = 'THUMBNAIL' | 'GALLERY'
export type MediaType = 'IMAGE' | 'VIDEO'

export interface Binding {
  target: string
  name: string
  role: Role
  order: number
  altText?: string
}

export interface PlannedFile {
  /** Path relative to the dropped folder, "/" separated. */
  relPath: string
  fileName: string
  mediaType: MediaType
  bindings: Binding[]
  /** Why this file cannot be sent (the store would refuse it). Empty = ready. */
  problems: string[]
  /** From a folder like 4x5/; informational, the store does not keep it. */
  aspectRatio?: string
}

export interface DropPlan {
  files: PlannedFile[]
  /** Not an error, but probably not intended: two photos fight for one slot. */
  warnings: string[]
  /** Files skipped because they are not a photo or video the store accepts. */
  ignored: string[]
}

export const KNOWN_TARGETS = ['product', 'variant', 'category', 'brand'] as const

/** What the store accepts (images: JPEG, PNG, WebP, GIF, AVIF; videos: MP4, WebM). */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']
const VIDEO_EXTENSIONS = ['.mp4', '.webm']

export function mediaTypeOf(fileName: string): MediaType | null {
  const dot = fileName.lastIndexOf('.')
  const ext = dot < 0 ? '' : fileName.slice(dot).toLowerCase()
  if (IMAGE_EXTENSIONS.includes(ext)) return 'IMAGE'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'VIDEO'
  return null
}

/** "4x5", "4:5", "ratio-16x9" -> "4:5". */
export function parseAspectRatio(segment: string): string | undefined {
  const clean = segment.trim().toLowerCase().replace(/^ratio[-_]?/, '').replace(/^aspect[-_]?/, '')
  const match = clean.match(/^(\d{1,2})[:x](\d{1,2})$/)
  return match ? `${match[1]}:${match[2]}` : undefined
}

export function detectRole(segmentOrFileName: string): Role | undefined {
  const lower = segmentOrFileName.toLowerCase()
  if (['thumbnail', 'thumb', 'cover', 'main', 'hero', 'logo', 'icon', 'avatar'].some((word) => lower.startsWith(word))) return 'THUMBNAIL'
  if (['gallery', 'images', 'photos', 'slides'].includes(lower) || lower.startsWith('gallery-') || lower.startsWith('gallery_')) return 'GALLERY'
  if (['banner', 'header', 'swatch', 'color'].some((word) => lower.startsWith(word))) return 'GALLERY'
  return undefined
}

export interface PlaceName {
  target?: string
  name: string
  order?: number
}

const isKnownTarget = (value: string) => (KNOWN_TARGETS as readonly string[]).includes(value)

/**
 * One folder name -> the places it names.
 *   `[a, b]` `variant[x, y]` `[product=a, category=b]` `[a@1, b@3]` `name`; older: `*:[a, b]` `product:[a]` `a:3`.
 */
export function parsePlaces(segment: string, defaultTarget = 'product'): PlaceName[] {
  const trimmed = segment.trim()
  if (!trimmed) return []
  const bracket = trimmed.match(/^(\*|[a-zA-Z0-9_-]+)?:?\[(.*)\]$/)
  if (bracket) {
    const prefix = bracket[1]
    const explicitTarget = prefix && prefix !== '*' ? prefix.toLowerCase() : undefined
    const results: PlaceName[] = []
    for (const entry of (bracket[2] ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
      let rest = entry
      let order: number | undefined
      const at = rest.match(/^(.*)@(\d+)$/)
      if (at) {
        rest = (at[1] ?? '').trim()
        order = parseInt(at[2] ?? '', 10)
      }
      const eq = rest.indexOf('=')
      if (eq > 0) {
        results.push({ target: rest.slice(0, eq).trim().toLowerCase(), name: rest.slice(eq + 1).trim(), order })
        continue
      }
      const parts = rest.split(':').map((part) => part.trim())
      const [first = '', second = '', third = ''] = parts
      if (parts.length === 3) {
        const n = parseInt(third, 10)
        results.push({ target: first.toLowerCase(), name: second, order: Number.isNaN(n) ? undefined : n })
      } else if (parts.length === 2) {
        const n = parseInt(second, 10)
        if (!Number.isNaN(n) && !isKnownTarget(first.toLowerCase())) results.push({ target: explicitTarget ?? defaultTarget, name: first, order: n })
        else results.push({ target: first.toLowerCase(), name: second, order })
      } else if (first) {
        results.push({ target: explicitTarget ?? defaultTarget, name: first, order })
      }
    }
    if (results.length > 0) return results
  }
  return [{ target: defaultTarget, name: trimmed }]
}

/** Position from a number/`order-3` folder, the file name (`01_front`, `front_01`, `1`), else undefined. THUMBNAIL is always 1. */
export function extractOrder(folders: string[], fileName: string, role: Role | undefined): number | undefined {
  if (role === 'THUMBNAIL') return 1
  for (const part of folders) {
    const trimmed = part.trim()
    if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10)
    const named = trimmed.match(/(?:order|pos|seq|sort)[-_:=](\d+)/i) ?? trimmed.match(/\[order=(\d+)\]/i)
    if (named?.[1]) return parseInt(named[1], 10)
  }
  const base = fileName.replace(/\.[^.]+$/, '')
  const prefix = base.match(/^(\d+)[\s._-]+/) ?? base.match(/^(\d+)$/) ?? base.match(/[\s._-]+(\d+)$/)
  return prefix?.[1] ? parseInt(prefix[1], 10) : undefined
}

/** `01_side-view.jpg` -> "Side view"; generic names (thumbnail, 1, logo...) give nothing. */
export function altTextOf(fileName: string): string | undefined {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  if (/^\d+$/.test(base) || ['thumbnail', 'thumb', 'cover', 'image', 'photo', 'gallery', 'logo', 'icon', 'avatar', 'banner'].includes(base.toLowerCase())) return undefined
  const text = base.replace(/^\d+[\s._-]+/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : undefined
}

/** What the store would refuse, so it can be said before anything is uploaded. */
export function bindingProblem(binding: Binding, mediaType: MediaType): string | null {
  const place = `${binding.target} "${binding.name}"`
  if (!isKnownTarget(binding.target)) return `unknown kind "${binding.target}" (use ${KNOWN_TARGETS.join(', ')})`
  if (binding.role === 'THUMBNAIL') {
    if (binding.target === 'variant') return `${place}: a variant has no thumbnail, put the photo in gallery/`
    if (mediaType !== 'IMAGE') return `${place}: a thumbnail must be an image`
  } else if (binding.target === 'category' || binding.target === 'brand') {
    return `${place}: a ${binding.target} has a single image, put the photo in thumbnail/`
  }
  return null
}

/**
 * Plans a whole folder. `relPaths` are relative to the dropped folder. Positions that no folder or file name gives are
 * the lowest free ones, in path order, so the result does not depend on the order the paths are listed in.
 */
export function planDrop(relPaths: string[]): DropPlan {
  const files: PlannedFile[] = []
  const ignored: string[] = []
  const explicit = new Set<Binding>()

  for (const relPath of [...relPaths].sort()) {
    const parts = relPath.split('/').filter(Boolean)
    const fileName = parts.pop() ?? relPath
    const mediaType = mediaTypeOf(fileName)
    if (!mediaType) {
      ignored.push(relPath)
      continue
    }

    const aspectRatio = parts.map(parseAspectRatio).find((ratio) => ratio !== undefined)
    const role = parts.map(detectRole).find((r) => r !== undefined) ?? detectRole(fileName)

    const places: PlaceName[] = []
    let currentTarget = 'product'
    const remaining: string[] = []
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? ''
      if (parseAspectRatio(part) || detectRole(part)) continue
      const lower = part.toLowerCase()
      if (isKnownTarget(lower) && i + 1 < parts.length) {
        currentTarget = lower
        places.push(...parsePlaces(parts[++i] ?? '', currentTarget))
      } else if (part.includes('[') && part.includes(']')) {
        places.push(...parsePlaces(part, currentTarget))
      } else if (lower === 'variants' && i + 1 < parts.length) {
        currentTarget = 'variant'
        places.push(...parsePlaces(parts[++i] ?? '', 'variant'))
      } else {
        remaining.push(part)
      }
    }
    if (places.length === 0) {
      // no kind given: the first folder is a product
      places.push(...(remaining[0] ? parsePlaces(remaining[0], 'product') : [{ target: 'product', name: 'default' }]))
    }

    const finalRole: Role = role ?? (parts.length === 1 && places.length === 1 ? 'THUMBNAIL' : 'GALLERY')
    const order = extractOrder(parts, fileName, finalRole)
    const altText = altTextOf(fileName)
    const bindings = places.map<Binding>((place) => {
      const binding: Binding = { target: place.target ?? currentTarget, name: place.name, role: finalRole, order: place.order ?? order ?? 1, altText }
      if (finalRole === 'THUMBNAIL') binding.order = 1
      else if (place.order !== undefined || order !== undefined) explicit.add(binding)
      return binding
    })
    files.push({ relPath, fileName, mediaType, bindings, aspectRatio, problems: bindings.map((b) => bindingProblem(b, mediaType)).filter((p): p is string => p !== null) })
  }

  // positions nobody asked for: the lowest free one in each (kind, name, role) group
  const used = new Map<string, Set<number>>()
  const slotKey = (b: Binding) => `${b.target}::${b.name}::${b.role}`
  const takenIn = (b: Binding): Set<number> => {
    const existing = used.get(slotKey(b))
    if (existing) return existing
    const created = new Set<number>()
    used.set(slotKey(b), created)
    return created
  }
  for (const file of files) {
    for (const b of file.bindings) if (b.role === 'THUMBNAIL' || explicit.has(b)) takenIn(b).add(b.order)
  }
  for (const file of files) {
    for (const b of file.bindings) {
      if (b.role === 'THUMBNAIL' || explicit.has(b)) continue
      const taken = takenIn(b)
      let next = 1
      while (taken.has(next)) next++
      b.order = next
      taken.add(next)
    }
  }

  const warnings: string[] = []
  const owners = new Map<string, string>()
  for (const file of files) {
    for (const b of file.bindings) {
      const key = `${slotKey(b)}#${b.order}`
      const other = owners.get(key)
      if (other && other !== file.relPath) warnings.push(`${b.target} "${b.name}" ${b.role.toLowerCase()} #${b.order} is claimed by ${other} and ${file.relPath}: the last one wins`)
      owners.set(key, file.relPath)
    }
  }
  return { files, warnings, ignored }
}

/** A name that is a valid folder name on Windows, macOS and Linux and that the folder syntax does not misread. */
export function isPortableName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return name.length > 0 && name.length <= 100 && !/[\\/:*?"<>|[\],=@\u0000-\u001f]/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name) && !/[. ]$/.test(name) && name !== '.' && name !== '..'
}
