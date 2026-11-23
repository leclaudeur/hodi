import { handleRules } from '../../../shared/handle.ts'
import { CONFIG } from './config.ts'

// The @identifier's rules with config.yml's lengths, as the server checks them.
export const { cleanHandle, handleBase } = handleRules(CONFIG.accounts)
