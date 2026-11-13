import { EyeOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SourceRequest, SourceStatus } from '../../../api.ts'
import Accordion from '../../../ui/Accordion.tsx'
import Button from '../../../ui/Button.tsx'
import Chip from '../../../ui/Chip.tsx'
import DaySeparator from '../../../ui/DaySeparator.tsx'
import SourceAvatar from '../../../ui/SourceAvatar.tsx'
import styles from '../Settings.module.css'
import sourceStyles from './SourcesSection.module.css'
import { type SourceGroup, type SourceSection, hostOf } from './sources-model.ts'

interface RequestsProps {
  requests: SourceRequest[] | null
  open: boolean
  onToggle: () => void
}

// A teen's requests, waiting for its parents; its intro says what they are while there is none.
export const RequestsAccordion = ({ requests, open, onToggle }: RequestsProps) => {
  const { t } = useTranslation()
  return (
    <Accordion
      title={t('requests.mine')}
      intro={t('sources.groupIntros.requests')}
      count={requests?.length ?? 0}
      tour="requests"
      open={open}
      onToggle={onToggle}
    >
      <ul className={sourceStyles.list}>
        {(requests ?? []).map(request => (
          <li key={request.id} className={sourceStyles.row}>
            <SourceAvatar sourceId="" sourceName={request.source.name} size={44} />
            <span className={styles.rowText}>
              <span className={`${styles.rowLabel} ${sourceStyles.name}`}>{request.source.name}</span>
              <span className={`${styles.rowHint} ${sourceStyles.name}`}>
                {request.source.domains[0] ?? hostOf(request.source.url)}
              </span>
            </span>
            <Chip tone="warning" size="row" label={t('requests.pendingLabel')}>
              {t('requests.pending')}
            </Chip>
          </li>
        ))}
      </ul>
    </Accordion>
  )
}

interface GroupProps {
  group: SourceGroup
  // A young profile's household group holds what its parents gave it.
  young: boolean
  sections: SourceSection[]
  open: boolean
  onToggle: () => void
  // "Peu ouvertes" filtered on: a button hides the group's ones at once.
  onHideLow: (() => void) | null
  row: (source: SourceStatus) => ReactNode
}

// A group of sources, under a separator per topic when it holds several.
export const GroupAccordion = ({ group, young, sections, open, onToggle, onHideLow, row }: GroupProps) => {
  const { t } = useTranslation()
  return (
    <Accordion
      title={group.title}
      intro={t(`sources.groupIntros.${young && group.id === 'household' ? 'parents' : group.id}`)}
      count={group.sources.length}
      open={open}
      onToggle={onToggle}
      action={
        onHideLow && (
          <Button look="danger" icon={EyeOff} onClick={onHideLow}>
            {t('sources.hideAll')}
          </Button>
        )
      }
    >
      {sections.map((section, index) => (
        <div key={section.id} className={sourceStyles.section}>
          {sections.length > 1 && (
            <DaySeparator
              label={section.label}
              count={section.sources.length}
              unit="source"
              first={index === 0}
              className={sourceStyles.topicSeparator}
            />
          )}
          <ul className={sourceStyles.list}>{section.sources.map(row)}</ul>
        </div>
      ))}
    </Accordion>
  )
}
