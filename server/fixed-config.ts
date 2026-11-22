import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseConfig } from '../shared/config-file.ts'

// config.yml, read once when the server starts, from the folder Hodi runs in (as sources.yml and gamification.yml).
export const CONFIG = parseConfig(readFileSync(path.resolve('config.yml'), 'utf8'))
