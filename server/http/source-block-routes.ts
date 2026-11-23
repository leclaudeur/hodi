import type express from 'express'
import { type BlockedDomainStore, blockTargetOf, coversTarget } from '../db/blocked-domain-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import { type Source, allSources } from '../news/catalog.ts'
import type { NewsService } from '../news/news-service.ts'
import { accountAsking } from './proof.ts'

// « Bloquer » a source, for illegal content: its site's domain (on a host shared by many, its feed alone), everywhere,
// for everyone, after the server admin's password and app code. Nothing of it stays, and the account that added it is
// blocked too; the admin never learns which.

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

// What blocking this source takes: the other sources on its domain (never sources.yml's), and its adder's account.
const reachOf = ({ news, official }: SourceBlockOptions, accounts: UserAccountStore, source: Source) => {
  const target = blockTargetOf(source)
  if (!target) return null
  const hit = allSources(news.catalog).filter(item => !official().has(item.id) && coversTarget(target, item))
  const adder = source.addedBy === undefined ? null : accounts.ofProfile(source.addedBy)
  return { target, hit, adder: adder && !adder.serverAdmin ? adder : null }
}

// The target blocked, every source on it gone, and the account that added this one blocked: only that one, as the
// others may have added another, harmless feed of the same site.
const block = (options: SourceBlockOptions, reach: NonNullable<ReturnType<typeof reachOf>>, helpers: Helpers) => {
  const { domains, news, onErased } = options
  domains.block(reach.target, helpers.now())
  domains.erase(reach.hit)
  const ids = reach.hit.map(source => source.id)
  ids.forEach(id => news.removeSource(id))
  onErased(ids)
  if (reach.adder) helpers.removeAccount?.(reach.adder, true)
}

export const mountSourceBlockRoutes = (router: express.Router, options: SourceBlockOptions, helpers: Helpers) => {
  const { domains, news, official } = options
  const { accounts, proven } = helpers

  // Sources bloquées: the domains, the latest first.
  router.get('/blocks', (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({ domains: domains.all() })
  })

  const sourceOrRefuse = (request: express.Request, response: express.Response) => {
    const source = allSources(news.catalog).find(candidate => candidate.id === request.params.id)
    if (!source) {
      response.status(404).json({ error: 'not_found' })
      return null
    }
    if (official().has(source.id)) {
      response.status(403).json({ error: 'official' })
      return null
    }
    const reach = reachOf(options, accounts, source)
    if (!reach) response.status(400).json({ error: 'bad_request' })
    return reach
  }

  // Said in the dialog before the password: what is blocked, how many sources go, and whether an account goes.
  router.get('/sources/:id/block', (request, response) => {
    const reach = sourceOrRefuse(request, response)
    if (reach) response.json({ target: reach.target, sources: reach.hit.length, account: reach.adder !== null })
  })

  router.post('/sources/:id/block', async (request, response) => {
    if (!sourceOrRefuse(request, response)) return
    if (!(await proven(request, response))) return
    // Read again after the password, which takes a moment; the admin who blocks it never goes with it.
    const reach = sourceOrRefuse(request, response)
    if (!reach) return
    const asking = accountAsking(response, accounts)
    block(options, { ...reach, adder: reach.adder?.id === asking?.id ? null : reach.adder }, helpers)
    response.json({ target: reach.target })
  })

  // « Débloquer »: someone may add it again; nothing that was erased comes back.
  router.delete('/blocks/:domain', async (request, response) => {
    // As it is listed; a domain typed with capitals or « www. » is the same one.
    const typed = request.params.domain
    const domain = typed.includes('/') ? typed : typed.toLowerCase().replace(/^www\./, '')
    if (!domains.all().some(entry => entry.domain === domain)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!(await proven(request, response))) return
    domains.unblock(domain)
    response.status(204).end()
  })
}
