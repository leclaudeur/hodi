import { Ban } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { blockSource, getBlockPreview } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import { rich } from '../../../ui/rich.tsx'
import SettingRow from '../../settings/SettingRow.tsx'
import settingsStyles from '../../settings/Settings.module.css'
import { inboxChanged } from './use-inbox.ts'

type Preview = Awaited<ReturnType<typeof getBlockPreview>>

const hostOf = (target: string) => {
  try {
    return new URL(target).hostname.replace(/^www\./, '')
  } catch {
    return target
  }
}

// What goes, in full: a whole domain or a feed alone on a host many share, how many sources, the adder's account.
const messageOf = ({ target, sources, account }: Preview, t: TFunction) =>
  [
    target.includes('/')
      ? t('server.blocks.block.textFeed', { host: hostOf(target) })
      : t('server.blocks.block.textDomain', { target }),
    t('server.blocks.block.erased', { count: sources }),
    account ? t('server.blocks.block.account') : '',
    t('server.blocks.block.final')
  ]
    .filter(Boolean)
    .join(' ')

// « Bloquer », for illegal content, at the foot of a source in À traiter: after the admin's password and app code. What
// it takes is read from the server first, and said in the dialog.
const BlockSourceRow = ({ source }: { source: { id: string; name: string } }) => {
  const { t } = useTranslation()
  const block = () =>
    getBlockPreview(source.id)
      .then(preview =>
        askToConfirm({
          title: t('server.blocks.block.title', { name: source.name }),
          message: rich(messageOf(preview, t)),
          label: t('server.blocks.block.button'),
          proof: {},
          onConfirm: async proof => {
            const { target } = await blockSource(source.id, proof)
            showSaved(t('server.blocks.block.done', { target: target.includes('/') ? source.name : target }))
            inboxChanged()
          }
        })
      )
      .catch(() => showError(t('server.blocks.block.failed')))
  return (
    <>
      <h2 className={settingsStyles.label}>{t('server.blocks.block.section')}</h2>
      <div className={settingsStyles.card}>
        <SettingRow
          label={t('server.blocks.block.label')}
          hint={t('server.blocks.block.hint')}
          action={{ label: t('server.blocks.block.short'), look: 'danger', icon: Ban, onClick: () => void block() }}
        />
      </div>
    </>
  )
}

export default BlockSourceRow
