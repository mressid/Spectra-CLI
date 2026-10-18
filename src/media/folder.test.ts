import { describe, expect, it } from 'vitest'
import { detectRole, extractOrder, altTextOf, isPortableName, parseAspectRatio, parsePlaces, planDrop } from './folder.ts'

const bindings = (paths: string[]) =>
  planDrop(paths).files.flatMap((f) => f.bindings.map((b) => `${b.target}:${b.name} ${b.role} #${b.order}`)).sort()

// The four example folders of the importer (store-importer/examples/media-folders): the CLI must read them the same way.
describe('the importer example folders', () => {
  it('01 one place per folder', () => {
    expect(bindings([
      'product/solitaire-gold/thumbnail/front.png',
      'product/solitaire-gold/gallery/01_side-view.png',
      'product/solitaire-gold/gallery/02_back.png',
      'variant/SOLI-GOLD-52/gallery/01_macro.png',
      'category/rings/thumbnail/rings.png',
      'brand/aurum/thumbnail/aurum-logo.png',
    ])).toEqual([
      'brand:aurum THUMBNAIL #1',
      'category:rings THUMBNAIL #1',
      'product:solitaire-gold GALLERY #1',
      'product:solitaire-gold GALLERY #2',
      'product:solitaire-gold THUMBNAIL #1',
      'variant:SOLI-GOLD-52 GALLERY #1',
    ])
  })

  it('02 one photo, many places', () => {
    expect(bindings([
      '[solitaire-gold, solitaire-silver]/thumbnail/studio-shot.png',
      '[solitaire-gold, solitaire-silver]/gallery/01_gift-box.png',
      '[product=solitaire-gold, category=rings]/thumbnail/rings-hero.png',
      'variant[SOLI-GOLD-52, SOLI-GOLD-54]/gallery/01_size-chart.png',
    ])).toEqual([
      'category:rings THUMBNAIL #1',
      'product:solitaire-gold GALLERY #1',
      'product:solitaire-gold THUMBNAIL #1',
      'product:solitaire-gold THUMBNAIL #1',
      'product:solitaire-silver GALLERY #1',
      'product:solitaire-silver THUMBNAIL #1',
      'variant:SOLI-GOLD-52 GALLERY #1',
      'variant:SOLI-GOLD-54 GALLERY #1',
    ])
  })

  it('03 gallery order and ratio', () => {
    const plan = planDrop([
      'product/ring-a/thumbnail/cover.png',
      'product/ring-a/gallery/1/front.png',
      'product/ring-a/gallery/2/back.png',
      'product/ring-a/gallery/order-3/angle.png',
      'product/ring-b/thumbnail/cover.png',
      'product/ring-b/4x5/gallery/01_on-model.png',
      'product/ring-b/4x5/gallery/02_on-hand.png',
      '[ring-a@4, ring-b@3]/gallery/macro.png',
    ])
    expect(plan.files.flatMap((f) => f.bindings.map((b) => `${b.target}:${b.name} ${b.role} #${b.order}`)).sort()).toEqual([
      'product:ring-a GALLERY #1',
      'product:ring-a GALLERY #2',
      'product:ring-a GALLERY #3',
      'product:ring-a GALLERY #4',
      'product:ring-a THUMBNAIL #1',
      'product:ring-b GALLERY #1',
      'product:ring-b GALLERY #2',
      'product:ring-b GALLERY #3',
      'product:ring-b THUMBNAIL #1',
    ])
    expect(plan.files.filter((f) => f.aspectRatio).map((f) => f.aspectRatio)).toEqual(['4:5', '4:5'])
    expect(plan.warnings).toEqual([])
  })

  it('04 whole shop', () => {
    expect(bindings([
      'brand/aurum/thumbnail/aurum-logo.png',
      'category/rings/thumbnail/rings.png',
      'category/necklaces/thumbnail/necklaces.png',
      'product/solitaire-gold/thumbnail/cover.png',
      'product/solitaire-gold/gallery/01_front.png',
      'product/solitaire-gold/gallery/02_side.png',
      'product/solitaire-silver/thumbnail/cover.png',
      'product/solitaire-silver/gallery/01_front.png',
      'variant/SOLI-GOLD-52/gallery/01_size-52.png',
      'variant/SOLI-GOLD-54/gallery/01_size-54.png',
      '[solitaire-gold, solitaire-silver]/gallery/03_packaging.png',
    ])).toEqual([
      'brand:aurum THUMBNAIL #1',
      'category:necklaces THUMBNAIL #1',
      'category:rings THUMBNAIL #1',
      'product:solitaire-gold GALLERY #1',
      'product:solitaire-gold GALLERY #2',
      'product:solitaire-gold GALLERY #3',
      'product:solitaire-gold THUMBNAIL #1',
      'product:solitaire-silver GALLERY #1',
      'product:solitaire-silver GALLERY #3',
      'product:solitaire-silver THUMBNAIL #1',
      'variant:SOLI-GOLD-52 GALLERY #1',
      'variant:SOLI-GOLD-54 GALLERY #1',
    ])
  })
})

describe('folder syntax', () => {
  it('reads the portable spelling and the older one the same way', () => {
    expect(parsePlaces('[product=ring-a@1, category=rings@2]')).toEqual(parsePlaces('*:[product:ring-a:1, category:rings:2]'))
    expect(parsePlaces('variant[SKU-1,SKU-2]')).toEqual([{ target: 'variant', name: 'SKU-1' }, { target: 'variant', name: 'SKU-2' }].map((p) => ({ ...p, order: undefined })))
    expect(parsePlaces('[ring-a@1, ring-b@3]').map((p) => p.order)).toEqual([1, 3])
    expect(parsePlaces('ring-gold')).toEqual([{ target: 'product', name: 'ring-gold' }])
  })

  it('reads aspect ratios, roles, positions and alt text', () => {
    expect(['4x5', '4:5', 'ratio-16x9', 'cover'].map(parseAspectRatio)).toEqual(['4:5', '4:5', '16:9', undefined])
    expect(['thumbnail', 'cover', 'logo', 'gallery', 'banner', 'swatch', 'front'].map(detectRole)).toEqual(['THUMBNAIL', 'THUMBNAIL', 'THUMBNAIL', 'GALLERY', 'GALLERY', 'GALLERY', undefined])
    expect(extractOrder([], '01_front.jpg', 'GALLERY')).toBe(1)
    expect(extractOrder([], 'front_03.jpg', 'GALLERY')).toBe(3)
    expect(extractOrder(['order-5'], 'x.jpg', 'GALLERY')).toBe(5)
    expect(extractOrder(['2'], 'x.jpg', 'GALLERY')).toBe(2)
    expect(extractOrder([], 'x.jpg', 'THUMBNAIL')).toBe(1)
    expect(altTextOf('01_side-view.jpg')).toBe('Side view')
    expect(altTextOf('thumbnail.jpg')).toBeUndefined()
  })

  it('uses the first folder as a product when no kind is given', () => {
    expect(bindings(['ring-a/gallery/01.png', 'ring-a/cover.png'])).toEqual(['product:ring-a GALLERY #1', 'product:ring-a THUMBNAIL #1'])
    // a photo straight inside the only folder, with no role, is that product's thumbnail
    expect(bindings(['ring-a/front.png'])).toEqual(['product:ring-a THUMBNAIL #1'])
  })
})

describe('planDrop', () => {
  it('does not depend on the order the paths are listed in', () => {
    const paths = ['product/a/gallery/x.png', 'product/a/gallery/y.png', 'product/a/gallery/03_z.png', 'product/a/thumbnail/t.png']
    const forward = planDrop(paths).files.map((f) => `${f.relPath} ${f.bindings[0]?.order}`)
    expect(planDrop([...paths].reverse()).files.map((f) => `${f.relPath} ${f.bindings[0]?.order}`)).toEqual(forward)
    // x and y take the free positions 1 and 2, around the explicit 3
    expect(forward).toEqual(['product/a/gallery/03_z.png 3', 'product/a/gallery/x.png 1', 'product/a/gallery/y.png 2', 'product/a/thumbnail/t.png 1'])
  })

  it('reports what the store would refuse, before anything is sent', () => {
    const plan = planDrop(['variant/SKU-1/thumbnail/a.png', 'category/rings/gallery/b.png', 'product/p/thumbnail/clip.mp4', 'widget/w/gallery/c.png'])
    const problems = Object.fromEntries(plan.files.map((f) => [f.relPath, f.problems.join(' | ')]))
    expect(problems['variant/SKU-1/thumbnail/a.png']).toContain('a variant has no thumbnail')
    expect(problems['category/rings/gallery/b.png']).toContain('single image')
    expect(problems['product/p/thumbnail/clip.mp4']).toContain('must be an image')
    // "widget" is not a kind: the first folder is read as a product name, which is valid
    expect(problems['widget/w/gallery/c.png']).toBe('')
  })

  it('ignores files that are not a photo or video the store accepts', () => {
    const plan = planDrop(['product/a/thumbnail/a.png', 'product/a/README.md', 'product/a/gallery/x.svg', 'product/a/gallery/y.mov'])
    expect(plan.files.map((f) => f.relPath)).toEqual(['product/a/thumbnail/a.png'])
    expect(plan.ignored.sort()).toEqual(['product/a/README.md', 'product/a/gallery/x.svg', 'product/a/gallery/y.mov'])
  })

  it('warns when two photos claim one slot', () => {
    const plan = planDrop(['product/a/gallery/1_x.png', 'product/a/gallery/01_y.png'])
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toContain('the last one wins')
  })
})

describe('isPortableName', () => {
  it('rejects what Windows rejects and what the folder syntax would misread', () => {
    for (const bad of ['a:b', 'a*', 'a/b', 'nul', 'end.', 'a@1', 'a=b', 'a,b', '[x]', '']) expect(isPortableName(bad), bad).toBe(false)
    for (const good of ['gold-ring', 'SKU-01', 'size_52']) expect(isPortableName(good), good).toBe(true)
  })
})
