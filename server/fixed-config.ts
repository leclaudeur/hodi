import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isMainThread, workerData } from 'node:worker_threads'
import { parseConfig } from '../shared/config-file.ts'
import type { Config } from '../shared/config-schema.ts'

// The plugin SDK's bundle carries the values it was built with (plugin-sdk/tsdown.config.ts): a plugin's folder has
// no config.yml.
declare const __HODI_CONFIG__: Config | undefined

// A plugin's sandbox thread gets the values from the server that started it, rather than reading the file again.
const fromParent = () => (isMainThread ? undefined : (workerData as { hodiConfig?: Config } | null)?.hodiConfig)

// config.yml, read once when the server starts, from the folder Hodi runs in (as sources.yml and gamification.yml).
const fromFile = () => parseConfig(readFileSync(path.resolve('config.yml'), 'utf8'))

export const CONFIG: Config =
  (typeof __HODI_CONFIG__ === 'undefined' ? undefined : __HODI_CONFIG__) ?? fromParent() ?? fromFile()
