import { Check, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { SourceAnswer } from '../../api.ts'
import { seeSourceAnswers } from '../../lib/source-answers.ts'
import { settingsHref } from '../../lib/use-hash-route.ts'
import RoundButton from '../../ui/RoundButton.tsx'
import rows from '../../ui/NoticeRows.module.css'
import { hostOf } from './RequestsPile.tsx'

// "Tes parents ont accepté": a teen's answered requests on top of its Réglages, accepted and refused together, as
// the reactions above "Partages". They stay while the teen is here, and are seen when it leaves (or the page
// goes); the cross takes one away at once.
let leaving: ReturnType<typeof setTimeout> | undefined

const RequestAnswers = ({ answers }: { answers: SourceAnswer[] }) => {
  const { t } = useTranslation()
  const shown = useRef<number[]>([])

  useEffect(() => {
    shown.current = answers.map(answer => answer.id)
  }, [answers])

  useEffect(() => {
    // A list mounted again at once (React's strict mode, a layout change) is not a teen leaving.
    clearTimeout(leaving)
    const leave = () => seeSourceAnswers(shown.current)
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      leaving = setTimeout(leave, 0)
    }
  }, [])

  return (
    <div className={`${rows.reactions} ${rows.settings}`}>
      {answers.map(answer => {
        const accepted = answer.status === 'accepted'
        const Icon = accepted ? Check : X
        return (
          <div key={answer.id} className={rows.row}>
            <a className={rows.link} href={settingsHref('sources')}>
              <span className={`${rows.icon} ${accepted ? rows.yes : rows.no}`} aria-hidden="true">
                <Icon size={14} strokeWidth={2.25} />
              </span>
              <span className={rows.text}>
                <span>
                  <Trans
                    i18nKey={accepted ? 'requests.answerAccepted' : 'requests.answerRefused'}
                    components={{ b: <b /> }}
                  />
                </span>
                <span className={rows.title}>
                  {answer.source.name} · {hostOf(answer)}
                </span>
              </span>
            </a>
            <RoundButton icon={X} label={t('shares.dismiss')} size={38} onClick={() => seeSourceAnswers([answer.id])} />
          </div>
        )
      })}
    </div>
  )
}

export default RequestAnswers
