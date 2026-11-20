import type { Config } from '../config.ts'
import type { AccountAiStore } from '../db/account-ai-store.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { aiProvider } from '../news/ai-providers.ts'
import type { AiTools } from '../news/news-types.ts'

interface AccountAiWiring {
  config: Config
  household: HouseholdStore
  accounts: UserAccountStore
  accountAi: AccountAiStore
}

// The AI tools of the account a profile reads with: its own key, its time zone and country. null for a profile with no
// account or an account with no key. Kept per account until its key or region changes.
export const accountAiTools = ({ config, household, accounts, accountAi }: AccountAiWiring) => {
  const kept = new Map<number, { signature: string; tools: AiTools }>()
  const toolsOf = (profileId: number): AiTools | null => {
    // A key taken away, or an account deleted, does not stay in memory.
    for (const accountId of kept.keys()) if (!accountAi.get(accountId)) kept.delete(accountId)
    const found = accountAi.ofProfile(profileId)
    const provider = found?.ai ? aiProvider(found.ai.provider) : null
    if (!found?.ai || !provider) return null
    const account = accounts.get(found.accountId)
    const current = household.get()
    const region = {
      timeZone: account?.timeZone ?? current.timeZone ?? config.timeZone,
      country: account?.country ?? current.country
    }
    const signature = JSON.stringify([found.ai, region])
    const known = kept.get(found.accountId)
    if (known?.signature === signature) return known.tools
    const tools = provider.tools({ key: found.ai.key, model: found.ai.model, region })
    kept.set(found.accountId, { signature, tools })
    return tools
  }
  return toolsOf
}
