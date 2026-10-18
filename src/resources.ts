/**
 * The store's REST resources, all with the same shape: GET / (paged), GET /{id}, POST /, PUT /{id}, DELETE /{id}.
 * `lookup` says how to find one by what people actually know (a slug, a SKU) instead of its UUID.
 * Authoritative DTOs: accessories-store-system/src/main/kotlin/com/accessorise/store/features/<name>/dto.
 */
import type { Client } from './client.ts'

export interface Lookup {
  /** Field of the record that holds the name. */
  field: string
  /** Query parameter of the list endpoint that finds it. */
  query: string
  /** The parameter matches a part ("skuContains"): the exact value is picked from the answer. */
  contains?: boolean
}

export interface Resource {
  name: string
  path: string
  lookup?: Lookup
  /** Columns of the table shown by `list`. */
  columns: string[]
  /** Only the owner (ADMIN) may use it; staff get a 403. */
  adminOnly?: boolean
}

const slug: Lookup = { field: 'slug', query: 'slug' }

export const RESOURCES: Resource[] = [
  { name: 'products', path: '/api/v1/products', lookup: slug, columns: ['id', 'slug', 'name', 'isActive', 'availability', 'priceFrom'] },
  { name: 'variants', path: '/api/v1/variants', lookup: { field: 'sku', query: 'skuContains', contains: true }, columns: ['id', 'sku', 'name', 'price', 'stockQuantity', 'isActive'] },
  { name: 'categories', path: '/api/v1/categories', lookup: slug, columns: ['id', 'slug', 'name', 'parentId', 'isActive', 'imageUrl'] },
  { name: 'brands', path: '/api/v1/brands', lookup: slug, columns: ['id', 'slug', 'name', 'country', 'logoUrl'] },
  { name: 'tags', path: '/api/v1/tags', lookup: slug, columns: ['id', 'slug', 'name'] },
  { name: 'collections', path: '/api/v1/collections', lookup: slug, columns: ['id', 'slug', 'name', 'isActive', 'startAt', 'endAt'] },
  { name: 'attributes', path: '/api/v1/attributes', columns: ['id', 'code', 'name', 'type', 'isVariantLevel'] },
  { name: 'attribute-values', path: '/api/v1/attribute-values', columns: ['id', 'attributeId', 'value', 'valueCode'] },
  { name: 'media', path: '/api/v1/media', columns: ['id', 'productId', 'variantId', 'mediaType', 'sortOrder', 'url'] },
  { name: 'orders', path: '/api/v1/orders', columns: ['id', 'number', 'status', 'grandTotal', 'currency', 'placedAt'] },
  { name: 'payments', path: '/api/v1/payments', columns: ['id', 'orderId', 'status', 'amount'] },
  { name: 'shipments', path: '/api/v1/shipments', columns: ['id', 'orderId', 'status', 'trackingNumber'] },
  { name: 'returns', path: '/api/v1/returns', columns: ['id', 'orderId', 'status'] },
  { name: 'reviews', path: '/api/v1/reviews', columns: ['id', 'productId', 'rating', 'title', 'isApproved'] },
  { name: 'bundles', path: '/api/v1/bundles', columns: ['id', 'name', 'isActive'] },
  { name: 'coupons', path: '/api/v1/admin/coupons', columns: ['id', 'code', 'isActive'], adminOnly: true },
  { name: 'warehouses', path: '/api/v1/admin/warehouses', columns: ['id', 'name'], adminOnly: true },
  { name: 'inventory-levels', path: '/api/v1/admin/inventory-levels', columns: ['id', 'variantId', 'warehouseId', 'quantity'], adminOnly: true },
  { name: 'showcases', path: '/api/v1/showcases', lookup: slug, columns: ['id', 'slug', 'title', 'sectionType', 'isActive'], adminOnly: true },
  { name: 'hero-slides', path: '/api/v1/hero-slides', columns: ['id', 'title', 'isActive', 'sortOrder', 'imageUrl'], adminOnly: true },
  { name: 'announcements', path: '/api/v1/announcements', columns: ['id', 'message', 'tone', 'isActive'], adminOnly: true },
  { name: 'users', path: '/api/v1/users', columns: ['id', 'email', 'firstName', 'lastName', 'role', 'isActive'], adminOnly: true },
  { name: 'addresses', path: '/api/v1/addresses', columns: ['id', 'userId', 'recipientName', 'city', 'countryCode'] },
  { name: 'carts', path: '/api/v1/carts', columns: ['id'] },
  { name: 'wishlists', path: '/api/v1/wishlists', columns: ['id'] },
]

export const findResource = (name: string): Resource | undefined => RESOURCES.find((resource) => resource.name === name)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Page<T> {
  content?: T[]
  page?: { size?: number; number?: number; totalElements?: number; totalPages?: number }
}

/** A UUID is used as it is; a slug or SKU is looked up. Throws when nothing, or more than one record, matches. */
export async function resolveId(client: Client, resource: Resource, ref: string): Promise<string> {
  if (UUID.test(ref)) return ref
  const { lookup } = resource
  if (!lookup) throw new Error(`${resource.name} are found by id only: pass the UUID (see: spectra ${resource.name} list)`)
  const page = await client.request<Page<Record<string, unknown>>>('GET', resource.path, { query: { [lookup.query]: ref, size: lookup.contains ? 100 : 5 } })
  const matches = (page.content ?? []).filter((row) => row[lookup.field] === ref)
  if (matches.length === 0) throw new Error(`No ${resource.name.replace(/s$/, '')} with ${lookup.field} "${ref}"`)
  const id = matches[0]?.id
  if (matches.length > 1 || typeof id !== 'string') throw new Error(`"${ref}" matches several ${resource.name}: pass the id`)
  return id
}

/** Every page of a list (200 per request). */
export async function listAll<T>(client: Client, path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T[]> {
  const all: T[] = []
  for (let page = 0; ; page++) {
    const result = await client.request<Page<T>>('GET', path, { query: { ...query, page, size: 200 } })
    const content = result?.content ?? []
    all.push(...content)
    const totalPages = result?.page?.totalPages
    if (content.length === 0 || (totalPages !== undefined ? page + 1 >= totalPages : content.length < 200)) return all
  }
}
