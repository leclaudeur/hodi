import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { SourceRequest } from '../../api.ts'
import { useProfiles } from '../../lib/profiles.ts'
import { requestHref } from '../../lib/use-hash-route.ts'
import ProfileAvatar from '../../ui/ProfileAvatar.tsx'
import rows from '../../ui/NoticeRows.module.css'

export const hostOf = (request: SourceRequest) =>
  request.source.domains[0] ?? (URL.canParse(request.source.url) ? new URL(request.source.url).hostname : '')

// "Zoé demande une source", on top of Réglages for a parent while a teen's request waits: one row each, as the
// reactions above "Partages", the oldest first. A row opens the request.
// Past three, the others fold under a last row, which never hides a single one.
const FOLDED = 3

const RequestsPile = ({ requests }: { requests: SourceRequest[] }) => {
  const { t } = useTranslation()
  const household = useProfiles({ onError: () => {} })
  const [unfolded, setUnfolded] = useState(false)
  const oldestFirst = [...requests].reverse()
  const folded = !unfolded && oldestFirst.length > FOLDED + 1
  const shown = folded ? oldestFirst.slice(0, FOLDED) : oldestFirst

  return (
    <div className={`${rows.reactions} ${rows.settings}`}>
      {shown.map(request => {
        const profile = household?.profiles.find(entry => entry.id === request.profileId)
        return (
          <div key={request.id} className={rows.row}>
            <a className={rows.link} href={requestHref(request.id)}>
              {profile && <ProfileAvatar profile={profile} size={28} />}
              <span className={rows.text}>
                <span>
                  <Trans
                    i18nKey={request.source.kind === 'video' ? 'requests.asksChannelRow' : 'requests.asksRow'}
                    values={{ name: profile?.name ?? '' }}
                    components={{ b: <b /> }}
                  />
                </span>
                <span className={rows.title}>
                  {request.source.name} · {hostOf(request)}
                </span>
              </span>
              <ChevronRight size={16} aria-hidden="true" className={rows.chevron} />
            </a>
          </div>
        )
      })}
      {folded && (
        <div className={rows.row}>
          <button type="button" className={`${rows.link} ${rows.more}`} onClick={() => setUnfolded(true)}>
            <span className={rows.text}>{t('requests.more', { count: oldestFirst.length - FOLDED })}</span>
            <ChevronDown size={16} aria-hidden="true" className={rows.chevron} />
          </button>
        </div>
      )}
    </div>
  )
}

export default RequestsPile
