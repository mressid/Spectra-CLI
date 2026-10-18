/** Uploads every photo of a folder and binds it by name: the "drop a folder" flow, from the command line. */
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { StoreApiError, type Client } from '../client.ts'
import { planDrop, type Binding, type DropPlan, type PlannedFile } from './folder.ts'

const MB = 1024 * 1024
/** The store's limits per file. */
const MAX_BYTES = { IMAGE: 5 * MB, VIDEO: 50 * MB } as const
/** PUT /admin/media/bindings takes at most 100 bindings per call. */
const MAX_BINDINGS_PER_CALL = 100

export interface BindingResult {
  target: string
  name: string
  role: string
  order: number
  status: 'APPLIED' | 'WAITING'
}

export interface FileResult {
  relPath: string
  /** Uploaded and bound. */
  ok: boolean
  /** Not sent: the plan found a problem. */
  skipped: boolean
  error?: string
  /** The store already had this exact file. */
  duplicate?: boolean
  results: BindingResult[]
}

export interface DropReport {
  plan: DropPlan
  results: FileResult[]
  applied: number
  waiting: number
  failed: number
  skipped: number
}

export interface DropOptions {
  /** Plan and check only: nothing is sent. */
  dryRun: boolean
  concurrency: number
  onFile?: (result: FileResult, done: number, total: number) => void
}

/** Relative "/" paths of the files under `dir`; anything starting with "." is left out. */
export async function scanFolder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const rel = relative(dir, join(entry.parentPath, entry.name)).split(sep)
    if (rel.some((part) => part.startsWith('.'))) continue
    paths.push(rel.join('/'))
  }
  return paths.sort()
}

async function addSizeProblems(dir: string, files: PlannedFile[]): Promise<void> {
  for (const file of files) {
    const { size } = await stat(join(dir, ...file.relPath.split('/')))
    const limit = MAX_BYTES[file.mediaType]
    if (size > limit) file.problems.push(`${(size / MB).toFixed(1)} MB is over the store's ${limit / MB} MB limit for ${file.mediaType === 'IMAGE' ? 'images' : 'videos'}`)
  }
}

const describe = (error: unknown): string =>
  error instanceof StoreApiError ? [error.message, ...error.fieldErrors].join(': ') : (error as Error).message

export async function dropFolder(client: Client, dir: string, options: DropOptions): Promise<DropReport> {
  const plan = planDrop(await scanFolder(dir))
  await addSizeProblems(dir, plan.files)

  const results: FileResult[] = new Array<FileResult>(plan.files.length)
  let next = 0
  let done = 0

  const handle = async (file: PlannedFile): Promise<FileResult> => {
    if (file.problems.length > 0) return { relPath: file.relPath, ok: false, skipped: true, error: file.problems.join('; '), results: [] }
    if (options.dryRun) {
      return { relPath: file.relPath, ok: true, skipped: false, results: [] }
    }
    try {
      const uploaded = await client.upload(join(dir, ...file.relPath.split('/')))
      const bound: BindingResult[] = []
      for (let i = 0; i < file.bindings.length; i += MAX_BINDINGS_PER_CALL) {
        const chunk: Binding[] = file.bindings.slice(i, i + MAX_BINDINGS_PER_CALL)
        const answer = await client.request<{ results: BindingResult[] }>('PUT', '/api/v1/admin/media/bindings', { body: { uploadedFileId: uploaded.id, bindings: chunk } })
        bound.push(...answer.results)
      }
      return { relPath: file.relPath, ok: true, skipped: false, duplicate: uploaded.duplicate, results: bound }
    } catch (error) {
      return { relPath: file.relPath, ok: false, skipped: false, error: describe(error), results: [] }
    }
  }

  async function worker(): Promise<void> {
    while (next < plan.files.length) {
      const index = next++
      const file = plan.files[index]
      if (!file) return
      const result = await handle(file)
      results[index] = result
      options.onFile?.(result, ++done, plan.files.length)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, plan.files.length)) }, worker))

  const all = results.filter(Boolean)
  return {
    plan,
    results: all,
    applied: all.flatMap((r) => r.results).filter((b) => b.status === 'APPLIED').length,
    waiting: all.flatMap((r) => r.results).filter((b) => b.status === 'WAITING').length,
    failed: all.filter((r) => !r.ok && !r.skipped).length,
    skipped: all.filter((r) => r.skipped).length,
  }
}
