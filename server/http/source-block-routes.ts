import type express from 'express'
import { type BlockedDomainStore, domainOf } from '../db/blocked-domain-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import { allSources } from '../news/catalog.ts'
import type { NewsService } from '../news/news-service.ts'
import { accountAsking } from './proof.ts'

// « Bloquer » a source, for illegal content: its domain, everywhere, for everyone, after the server admin's password
// and app code. Nothing of it stays, and the account that added it is blocked too; the admin never learns which.

export interface SourceBlockOptions {
  domains: BlockedDomainStore
  news: NewsService
  // sources.yml's ids: the file brings them back at each start, so they are never blocked.
  official: () => Set<string>
  // The sources gone: À traiter forgets them, everyone's lists hear of it.
  onErased: (sourceIds: string[]) => void
}

interface Helpers {
  accounts: UserAccountStore
  proven: (request: express.Request, response: express.Response) => Promise<boolean>
  // An account gone from the server, its e-mail blocked; null without what deletes accounts (older tests).
  removeAccount: ((account: UserAccount, blocks: boolean) => void) | null
  now: () => number
}

// Every source on the blocked domain, gone, and the accounts that added them blocked: never the server's admin.
const blockDomain = ({ domains, news, official, onErased }: SourceBlockOptions, helpers: Helpers, domain: string) => {
  const { accounts, removeAccount, now } = helpers
  domains.block(domain, now())
  const hit = allSources(news.catalog).filter(source => !official().has(source.id) && domains.covers(source))
  const adders = new Set(hit.flatMap(source => (source.addedBy === undefined ? [] : [source.addedBy])))
  const ids = hit.map(source => source.id)
  domains.erase(ids)
  ids.forEach(id => news.removeSource(id))
  onErased(ids)
  for (const profileId of adders) {
    const adder = accounts.ofProfile(profileId)
    if (adder && !adder.serverAdmin) removeAccount?.(adder, true)
  }
}

export const mountSourceBlockRoutes = (router: express.Router, options: SourceBlockOptions, helpers: Helpers) => {
  const { domains, news, official } = options
  const { accounts, proven } = helpers

  // Sources bloquées: the domains, the latest first.
  router.get('/blocks', (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({ domains: domains.all() })
  })

  router.post('/sources/:id/block', async (request, response) => {
    const source = allSources(news.catalog).find(candidate => candidate.id === request.params.id)
    if (!source) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (official().has(source.id)) {
      response.status(403).json({ error: 'official' })
      return
    }
    const domain = domainOf(source.domains[0] ? `https://${source.domains[0]}/` : source.url)
    if (!domain) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!(await proven(request, response))) return
    // The admin who blocks it never goes with it, even if they added it.
    const asking = accountAsking(response, accounts)
    blockDomain(options, { ...helpers, removeAccount: guarded(helpers.removeAccount, asking) }, domain)
    response.json({ domain })
  })

  // « Débloquer »: someone may add it again; nothing that was erased comes back.
  router.delete('/blocks/:domain', async (request, response) => {
    const domain = request.params.domain.toLowerCase()
    if (!domains.all().some(entry => entry.domain === domain)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!(await proven(request, response))) return
    domains.unblock(domain)
    response.status(204).end()
  })
}

const guarded = (remove: Helpers['removeAccount'], asking: UserAccount | null) =>
  remove && ((account: UserAccount, blocks: boolean) => account.id !== asking?.id && remove(account, blocks))
