import { Monitor, Smartphone, Tablet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ServerOverview } from '../../../api.ts'
import Chip from '../../../ui/Chip.tsx'
import Donut, { Keys } from './Donut.tsx'
import styles from './OverviewCards.module.css'
import board from './Overview.module.css'

const DEVICES = {
  computer: { colour: 'var(--rust)', Icon: Monitor },
  phone: { colour: 'var(--topic-world)', Icon: Smartphone },
  tablet: { colour: 'var(--topic-tech)', Icon: Tablet }
} as const

// Who has Hodi open now, by kind of device, then by first name (and household, when there are several). The list
// takes the card's free height and scrolls: the card never grows with the people online.
const OnlineCard = ({ online, households }: { online: ServerOverview['online']; households: number }) => {
  const { t } = useTranslation()
  const parts = (['computer', 'phone', 'tablet'] as const).map(device => ({
    key: device,
    name: t(`server.overview.device.${device}`),
    value: online.filter(row => row.device === device).length,
    colour: DEVICES[device].colour
  }))
  return (
    <section className={`${board.card} ${styles.online}`} aria-labelledby="overview-online">
      <div className={board.cardHead}>
        <h2 id="overview-online" className={board.cardTitle}>
          {t('server.overview.online')}
        </h2>
        <Chip tone="success">
          <i className={styles.pulse} />
          {t('server.overview.live')}
        </Chip>
      </div>
      <div className={styles.ringRow}>
        <Donut
          parts={parts}
          centre={String(online.length)}
          caption={t('server.overview.profiles', { count: online.length })}
        />
        <Keys parts={parts} />
      </div>
      {online.length ? (
        <ul className={styles.people}>
          {online.map(row => {
            const { colour, Icon } = DEVICES[row.device]
            return (
              <li key={`${row.name}-${row.household}-${row.device}`}>
                <span className={styles.avatar} style={{ background: colour }}>
                  {row.name.slice(0, 1)}
                </span>
                <span className={styles.who}>
                  <b>{row.name}</b>
                  {households > 1 && <small>{row.household}</small>}
                </span>
                <Icon size={16} className={styles.device} aria-label={t(`server.overview.device.${row.device}`)} />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className={styles.nobody}>{t('server.overview.onlineEmpty')}</p>
      )}
    </section>
  )
}

export default OnlineCard
