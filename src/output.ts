/** Text output: aligned tables for lists, indented JSON for everything else. */

const MAX_CELL = 48

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const oneLine = text.replace(/\s+/g, ' ')
  return oneLine.length > MAX_CELL ? `${oneLine.slice(0, MAX_CELL - 1)}…` : oneLine
}

export function formatTable(rows: Record<string, unknown>[], columns: string[]): string {
  if (rows.length === 0) return ''
  const body = rows.map((row) => columns.map((column) => cell(row[column])))
  const widths = columns.map((column, index) => Math.max(column.length, ...body.map((line) => (line[index] ?? '').length)))
  const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index] ?? 0)).join('  ').trimEnd()
  return [line(columns.map((column) => column.toUpperCase())), ...body.map(line)].join('\n') + '\n'
}

export const formatJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
