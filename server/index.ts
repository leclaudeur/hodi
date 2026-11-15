import { loadConfig } from './config.ts'
import { realOutside, startHodi } from './start.ts'

await startHodi(loadConfig(), realOutside())
