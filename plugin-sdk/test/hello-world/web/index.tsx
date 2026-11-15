import { useEffect, useState } from 'react'
import {
  Button,
  OverviewCard,
  SectionPage,
  SettingRow,
  SettingsCard,
  definePlugin,
  showError,
  usePluginApi,
  usePluginServerApi,
  usePluginTranslation
} from 'hodi:sdk'
import './hello.css'

// The web part: a card under the plugin's options, a section of the server's space and a card of its overview, drawn with Hodi's own
// components.
const HelloCard = () => {
  const { t } = usePluginTranslation()
  const api = usePluginApi()
  const [said, setSaid] = useState<{ text: string; count: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const sayHello = async () => {
    setBusy(true)
    try {
      const response = await api('/hello', { method: 'POST' })
      if (!response.ok) throw new Error(String(response.status))
      setSaid((await response.json()) as { text: string; count: number })
    } catch {
      showError(t('failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hello-world-card">
      <SettingRow label={said ? said.text : t('title')} hint={said ? t('count', { count: said.count }) : t('hint')}>
        <Button compact busy={busy} onClick={() => void sayHello()}>
          {t('say')}
        </Button>
      </SettingRow>
    </div>
  )
}

// Its section of the server's space, for the server's admin: how many hellos the household said.
const SaidPage = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = usePluginTranslation()
  const serverApi = usePluginServerApi()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    serverApi('/said')
      .then(response => response.json() as Promise<{ count: number }>)
      .then(said => setCount(said.count))
      .catch(() => showError(t('failed')))
  }, [serverApi, t])

  return (
    <SectionPage title={t('server.said')} intro={t('server.intro')} layout={layout}>
      {count !== null && (
        <SettingsCard>
          <SettingRow label={t('server.total')} value={t('count', { count })} />
        </SettingsCard>
      )}
    </SectionPage>
  )
}

// Its card on Serveur › Vue d'ensemble: the hellos said so far, whatever the period shown (from, to).
const SaidCard = ({ from, to }: { from: string; to: string }) => {
  const { t } = usePluginTranslation()
  const serverApi = usePluginServerApi()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    serverApi('/said')
      .then(response => response.json() as Promise<{ count: number }>)
      .then(said => setCount(said.count))
      .catch(() => setCount(null))
  }, [serverApi])

  return (
    <OverviewCard title={t('server.said')} count={count ?? undefined}>
      <p className="hello-world-period">{t('server.period', { from, to })}</p>
    </OverviewCard>
  )
}

const SaidHint = () => {
  const { t } = usePluginTranslation()
  return <>{t('server.hint')}</>
}

definePlugin({
  settingsPage: HelloCard,
  serverSections: [{ id: 'said', label: 'server.said', hint: SaidHint, page: SaidPage }],
  overviewCards: [{ id: 'said', size: 'narrow', component: SaidCard }]
})
