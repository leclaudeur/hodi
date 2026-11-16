import type { MailRow } from '../mail/template.ts'

// A plugin's table in the weekly report (its weeklyReport hook): a few rows of plain text, each a label, a value and
// maybe its change since the week before, which Hodi shows green when good and red otherwise.

const MAX_ROWS = 8
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const line = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max && !CONTROL.test(value)

const rowOf = (value: unknown): MailRow | null => {
  if (!isRecord(value) || !line(value.label, 60) || !line(value.value, 30)) return null
  const { change } = value
  if (change === undefined) return { label: value.label.trim(), value: value.value.trim() }
  if (!isRecord(change) || !line(change.text, 20) || typeof change.good !== 'boolean') return null
  return {
    label: value.label.trim(),
    value: value.value.trim(),
    change: { text: change.text.trim(), good: change.good }
  }
}

// The rows, or null when the answer is not { rows: [...] } with one to eight right rows.
export const pluginReportRows = (value: unknown): MailRow[] | null => {
  if (!isRecord(value) || !Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > MAX_ROWS) {
    return null
  }
  const rows = value.rows.map(rowOf)
  return rows.every(row => row !== null) ? (rows as MailRow[]) : null
}
