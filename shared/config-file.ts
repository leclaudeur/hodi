import bytes from 'bytes'
import ms from 'ms'
import { parse } from 'yaml'
import { type Config, CONFIG_SCHEMA, type ConfigKind } from './config-schema.ts'

// Reads config.yml: snake_case in the file, camelCase in the code. Every key of the schema must be there with a value
// of its kind, and nothing else: a typo stops Hodi at start rather than quietly keeping the old behaviour.

const camel = (key: string) => key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
const snake = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)

const DURATION = /^\d+(ms|s|m|h|d)$/
const SIZE = /^\d+(KB|MB)$/

const KIND_HINTS: Record<ConfigKind, string> = {
  count: 'a whole number, 0 or more',
  ratio: 'a number, 0 or more',
  duration: 'a duration such as 500ms, 30s, 15m, 3h or 7d',
  size: 'a size such as 256KB or 8MB',
  text: 'some text',
  list: 'a list of texts'
}

// Each kind's value as the code uses it, or undefined when the file's value is not of that kind.
const READERS: Record<ConfigKind, (value: unknown) => unknown> = {
  count: value => (Number.isInteger(value) && (value as number) >= 0 ? value : undefined),
  ratio: value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined),
  duration: value => (typeof value === 'string' && DURATION.test(value) ? ms(value as ms.StringValue) : undefined),
  size: value => (typeof value === 'string' && SIZE.test(value) ? bytes.parse(value) : undefined),
  text: value => (typeof value === 'string' && value.trim() !== '' ? value : undefined),
  list: value =>
    Array.isArray(value) && value.every(item => typeof item === 'string' && item !== '') ? value : undefined
}

const groupOf = (name: string, raw: unknown, schema: Record<string, ConfigKind>) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new Error(`config.yml: ${snake(name)} is missing`)
  const entries = new Map(Object.entries(raw).map(([key, value]) => [camel(key), { key, value }]))
  const unknown = [...entries.values()].find(({ key }) => !Object.hasOwn(schema, camel(key)))
  if (unknown) throw new Error(`config.yml: ${snake(name)}.${unknown.key} is not a setting`)
  return Object.fromEntries(
    Object.entries(schema).map(([key, kind]) => {
      const value = READERS[kind](entries.get(key)?.value)
      if (value === undefined) throw new Error(`config.yml: ${snake(name)}.${snake(key)} must be ${KIND_HINTS[kind]}`)
      return [key, value]
    })
  )
}

export const parseConfig = (text: string): Config => {
  const raw: unknown = parse(text)
  if (typeof raw !== 'object' || raw === null) throw new Error('config.yml is empty')
  const groups = new Map(Object.entries(raw).map(([name, value]) => [camel(name), { name, value }]))
  const unknown = [...groups.values()].find(({ name }) => !Object.hasOwn(CONFIG_SCHEMA, camel(name)))
  if (unknown) throw new Error(`config.yml: ${unknown.name} is not a group of settings`)
  const schema: Record<string, Record<string, ConfigKind>> = CONFIG_SCHEMA
  return Object.fromEntries(
    Object.entries(schema).map(([name, keys]) => [name, groupOf(name, groups.get(name)?.value, keys)])
  ) as Config
}
