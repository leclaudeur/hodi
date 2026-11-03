import { loadConfig } from './config.ts'
import { realOutside, startHodi } from './start.ts'

startHodi(loadConfig(), realOutside())
