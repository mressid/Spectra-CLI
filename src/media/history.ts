/** Keeps a finished folder drop in the store's import history (POST /api/v1/admin/import-runs). */
import { StoreApiError, type Client } from '../client.ts'
import type { DropReport, FileResult } from './drop.ts'

type ItemStatus = 'UPLOADED' | 'DUPLICATE' | 'FAILED' | 'APPLIED' | 'WAITING'

interface Item {
  kind: 'UPLOAD' | 'BINDING'
  key: string
  label?: string
  status: ItemStatus
  message?: string
}

export interface RunRecord {
  source: 'CLI'
  label: string
  startedAt: string
  finishedAt: string
  items: Item[]
}

const MAX_MESSAGE = 1000

/** One UPLOAD per file sent, then one BINDING per placement. Files the plan refused were never sent and are only counted in the label. */
export function dropRecord(report: DropReport, times: { startedAt: string; finishedAt: string }): RunRecord {
  const sent = report.results.filter((r: FileResult) => !r.skipped)
  const items: Item[] = sent.map((r) =>
    r.ok
      ? { kind: 'UPLOAD', key: r.relPath, status: r.duplicate ? 'DUPLICATE' : 'UPLOADED' }
      : { kind: 'UPLOAD', key: r.relPath, status: 'FAILED', message: (r.error ?? '').slice(0, MAX_MESSAGE) },
  )
  for (const r of sent) {
    for (const b of r.results) items.push({ kind: 'BINDING', key: `${b.target}/${b.name}/${b.role.toLowerCase()}/${b.order}`, label: r.relPath, status: b.status })
  }
  const skipped = report.skipped > 0 ? `, ${report.skipped} skipped` : ''
  return { source: 'CLI', label: `Media drop: ${sent.length} file${sent.length === 1 ? '' : 's'}${skipped}`, ...times, items }
}

/** Never throws: a store without the history, or an expired login, must not turn a finished upload into a failure. */
export async function saveDrop(client: Client, record: RunRecord): Promise<string | null> {
  if (record.items.length === 0) return null
  try {
    await client.request('POST', '/api/v1/admin/import-runs', { body: record })
    return null
  } catch (error) {
    return error instanceof StoreApiError ? [error.message, ...error.fieldErrors].join(': ') : (error as Error).message
  }
}
