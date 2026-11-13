import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, type StagedPlugin, getCatalog, stageFromCatalog } from '../../../../api.ts'
import { type CatalogPlugin, availableOf, updateOf } from '../../../../plugins/catalog.ts'
import type { PluginInfo } from '../../../../plugins/registry.ts'

const ERRORS = ['download_failed', 'checksum_mismatch', 'not_a_package', 'invalid_manifest', 'signed_only'] as const

// Hodi's plugin registry, read once per visit of Serveur › Plugins, and a plugin of it downloaded and checked by the
// server before the same questions as a file.
export const useCatalog = (installed: PluginInfo[] | null) => {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<CatalogPlugin[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [staging, setStaging] = useState<string | null>(null)
  const [staged, setStaged] = useState<StagedPlugin | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCatalog().then(setCatalog, () => setFailed(true))
  }, [])

  const stage = async (id: string) => {
    setStaging(id)
    setError(null)
    try {
      setStaged(await stageFromCatalog(id))
    } catch (caught) {
      const code = caught instanceof RequestError ? caught.code : null
      const known = ERRORS.includes(code as (typeof ERRORS)[number])
      setError(
        known ? t(`plugins.catalog.errors.${code as (typeof ERRORS)[number]}`) : t('plugins.catalog.errors.failed')
      )
    } finally {
      setStaging(null)
    }
  }

  return {
    available: catalog && installed ? availableOf(catalog, installed) : null,
    updateOf: (plugin: PluginInfo) => (catalog ? updateOf(catalog, plugin) : null),
    failed,
    staging,
    staged,
    error,
    stage,
    // The dialog closed: the next install reads the package again.
    clear: () => setStaged(null)
  }
}
