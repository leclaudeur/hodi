import type { ServerNoticeKind } from '../api.ts'
import { pluginName } from '../plugins/plugin-texts.ts'
import { t } from './i18n.ts'

// A row of Serveur › Notifications in the language shown: the core's kinds from the app's texts, a plugin's from its
// locales, else from its manifest.
// The core's own kinds, by key.
const CORE_KINDS: Record<string, () => { label: string; hint: string }> = {
  'code-request': () => ({
    label: t('server.notifications.codeRequest.label'),
    hint: t('server.notifications.codeRequest.hint')
  }),
  'source-review': () => ({
    label: t('server.notifications.sourceReview.label'),
    hint: t('server.notifications.sourceReview.hint')
  }),
  'weekly-report': () => ({
    label: t('server.notifications.weeklyReport.label'),
    hint: t('server.notifications.weeklyReport.hint')
  })
}

export const noticeTexts = (kind: ServerNoticeKind, language: string) => {
  const core = kind.plugin ? undefined : CORE_KINDS[kind.key]
  if (core) return core()
  const own = kind.translations[language] ?? kind.translations[language.slice(0, 2)]
  return { label: own?.label ?? kind.label ?? kind.key, hint: own?.hint ?? kind.hint ?? null }
}

export interface NoticeGroup {
  id: string
  name: string
  kinds: ServerNoticeKind[]
}

// The core's kinds under « Serveur », then each plugin's under its name, in the server's order.
export const noticeGroups = (kinds: ServerNoticeKind[], language: string): NoticeGroup[] => {
  const groups: NoticeGroup[] = []
  for (const kind of kinds) {
    const id = kind.plugin?.id ?? 'core'
    const group = groups.find(candidate => candidate.id === id)
    if (group) group.kinds.push(kind)
    else
      groups.push({
        id,
        name: kind.plugin ? pluginName(kind.plugin, language) : t('server.notifications.core'),
        kinds: [kind]
      })
  }
  return groups
}
