import { handleRules } from '../shared/handle.ts'
import { CONFIG } from './fixed-config.ts'

// The @identifier's rules with config.yml's lengths.
export const { cleanHandle, handleFrom, handleBase } = handleRules(CONFIG.accounts)
