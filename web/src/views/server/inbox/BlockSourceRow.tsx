import { Ban } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { blockSource } from '../../../api.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { showSaved } from '../../../lib/toast.ts'
import RichText from '../../../ui/RichText.tsx'
import SettingRow from '../../settings/SettingRow.tsx'
import settingsStyles from '../../settings/Settings.module.css'
import { inboxChanged } from './use-inbox.ts'

// The site's domain, as the server blocks it: its host without « www. ».
const domainOf = (site: string) => {
  try {
    return new URL(site).hostname.replace(/^www\./, '')
  } catch {
    return site
  }
}

// « Bloquer », for illegal content, at the foot of a source in À traiter: its whole domain, everywhere, after the
// admin's password and app code. What goes is said in full first.
const BlockSourceRow = ({ source }: { source: { id: string; name: string; site: string } }) => {
  const { t } = useTranslation()
  const domain = domainOf(source.site)
  const block = () =>
    askToConfirm({
      title: t('server.blocks.block.title', { name: source.name }),
      message: <RichText i18nKey="server.blocks.block.text" values={{ domain }} />,
      label: t('server.blocks.block.button'),
      proof: {},
      onConfirm: async proof => {
        await blockSource(source.id, proof)
        showSaved(t('server.blocks.block.done', { domain }))
        inboxChanged()
      }
    })
  return (
    <>
      <h2 className={settingsStyles.label}>{t('server.blocks.block.section')}</h2>
      <div className={settingsStyles.card}>
        <SettingRow
          label={t('server.blocks.block.label')}
          hint={t('server.blocks.block.hint')}
          action={{ label: t('server.blocks.block.short'), look: 'danger', icon: Ban, onClick: block }}
        />
      </div>
    </>
  )
}

export default BlockSourceRow
