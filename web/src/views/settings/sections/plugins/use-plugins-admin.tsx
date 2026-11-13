import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getPlugins, removePlugin, updatePlugin } from '../../../../api.ts'
import { askToConfirm } from '../../../../lib/confirm.ts'
import { showError, showSaved } from '../../../../lib/toast.ts'
import { serverHref } from '../../../../lib/use-hash-route.ts'
import type { PluginInfo } from '../../../../plugins/registry.ts'
import { currentBoot } from '../../../../plugins/restart.ts'
import RichText from '../../../../ui/RichText.tsx'
import { pluginName } from '../../../../plugins/plugin-texts.ts'

export interface Restarting {
  change: Promise<string | null>
  step: string
  failed: string
}

// The plugins installed, changing one, removing one, and the restart that follows.
export const usePluginsAdmin = () => {
  const { t } = useTranslation()
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [restarting, setRestarting] = useState<Restarting | null>(null)

  const load = useCallback(() => {
    getPlugins()
      .then(setPlugins)
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  const replace = (next: PluginInfo) =>
    setPlugins(current => current?.map(plugin => (plugin.id === next.id ? { ...plugin, ...next } : plugin)) ?? null)

  const change = (plugin: PluginInfo, patch: { enabled?: boolean; settings?: Record<string, unknown> }) =>
    void updatePlugin(plugin.id, patch)
      .then(next => {
        replace(next)
        showSaved()
      })
      .catch(() => showError(t('plugins.saveFailed')))

  // withData: nothing of it stays, neither its settings nor its own database.
  const remove = (plugin: PluginInfo, withData = false) =>
    askToConfirm({
      title: t(withData ? 'plugins.confirmRemoveAll.title' : 'plugins.confirmRemove.title'),
      message: (
        <RichText
          i18nKey={withData ? 'plugins.confirmRemoveAll.message' : 'plugins.confirmRemove.message'}
          values={{ name: pluginName(plugin) }}
        />
      ),
      label: t(withData ? 'plugins.confirmRemoveAll.button' : 'plugins.confirmRemove.button'),
      // The server admin's password first; a wrong one stays in the question. Then the restart screen.
      proof: {},
      onConfirm: async proof => {
        const before = await currentBoot()
        await removePlugin(plugin.id, withData, proof)
        // The plugin's page is gone: the reload after the restart opens the list instead. replaceState keeps the page
        // as it is until then, with no hashchange under the restart screen.
        window.history.replaceState(window.history.state, '', serverHref('plugins'))
        setRestarting({
          change: Promise.resolve(before),
          step: t('plugins.restart.removing', { name: pluginName(plugin) }),
          failed: t('plugins.removeFailed')
        })
      }
    })

  const restartFailed = useCallback(() => {
    showError(restarting?.failed ?? '')
    setRestarting(null)
  }, [restarting])

  return { plugins, failed, restarting, setRestarting, change, remove, restartFailed }
}
