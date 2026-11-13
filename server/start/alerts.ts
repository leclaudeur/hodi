import type { Config } from '../config.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import type { UserStore } from '../db/user-store.ts'
import type { YouthStore } from '../db/youth-store.ts'
import { DEFAULT_ACCOUNT_ID, inHousehold } from '../db/household-scope.ts'
import { FollowedAlerts } from '../news/followed-alerts.ts'
import { MAX_TOPIC_LIMIT, type NewsService } from '../news/news-service.ts'
import type { Outside } from './outside.ts'

// Notifications for followed subjects, on the devices of each profile (start.ts).
export const createAlerts = ({
  config,
  outside,
  news,
  profiles,
  users,
  youth
}: {
  config: Config
  outside: Outside
  news: NewsService
  profiles: ProfileStore
  users: UserStore
  youth: YouthStore
}) =>
  new FollowedAlerts({
    listItems: householdId =>
      inHousehold(householdId, async () => {
        const topics = await Promise.all(
          news.catalog.topics.map(topic => news.getTopic(topic.id, MAX_TOPIC_LIMIT, { background: true }))
        )
        return topics.flatMap(topic => topic?.items ?? [])
      }),
    householdOf: profileId => profiles.householdOf(profileId) ?? DEFAULT_ACCOUNT_ID,
    // A young profile's parents decide when it is told anything.
    mayNotify: (profileId, now) =>
      inHousehold(profiles.householdOf(profileId) ?? DEFAULT_ACCOUNT_ID, () => {
        const profile = profiles.get(profileId)
        return !profile || profile.kind === 'adult' || youth.mayNotify(profileId, now)
      }),
    subscriptions: {
      list: () => users.listPushSubscriptions(),
      save: settings => users.savePushSubscription(settings, Date.now()),
      remove: endpoint => users.removePushSubscription(endpoint)
    },
    send: (target, payload) => outside.sendPush(target, payload, config.vapid)
  })
