import type { MailRow } from '../mail/template.ts'
import { type Written, writtenIn, writtenOf } from './written.ts'
import type { Language } from '../../shared/i18n.ts'
import { CONFIG } from '../fixed-config.ts'

// A plugin's table in the weekly report (its weeklyReport hook): a few rows of plain text, each a label, a value and
// maybe its change since the week before, which Hodi shows green when good and red otherwise. Each text is one, or
// one per language, so that each admin reads the table in their own.

export interface ReportRow {
  label: Written
  value: Written
  change?: { text: Written; good: boolean }
}

const MAX_ROWS = CONFIG.plugins.reportRows
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fitting =
  (max: number) =>
  (value: unknown): value is string =>
    typeof value === 'string' && value.trim() !== '' && value.length <= max && !CONTROL.test(value)

const rowOf = (value: unknown): ReportRow | null => {
  if (!isRecord(value)) return null
  const label = writtenOf(value.label, fitting(60))
  const shown = writtenOf(value.value, fitting(30))
  if (!label || !shown) return null
  const { change } = value
  if (change === undefined) return { label, value: shown }
  const text = isRecord(change) ? writtenOf(change.text, fitting(20)) : null
  if (!text || !isRecord(change) || typeof change.good !== 'boolean') return null
  return { label, value: shown, change: { text, good: change.good } }
}

// The rows, or null when the answer is not { rows: [...] } with one to eight right rows.
export const pluginReportRows = (value: unknown): ReportRow[] | null => {
  if (!isRecord(value) || !Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > MAX_ROWS) {
    return null
  }
  const rows = value.rows.map(rowOf)
  return rows.every(row => row !== null) ? (rows as ReportRow[]) : null
}

// The rows as one admin reads them.
export const reportRowsIn = (rows: ReportRow[], language: Language): MailRow[] =>
  rows.map(({ label, value, change }) => ({
    label: writtenIn(label, language),
    value: writtenIn(value, language),
    ...(change ? { change: { text: writtenIn(change.text, language), good: change.good } } : {})
  }))
