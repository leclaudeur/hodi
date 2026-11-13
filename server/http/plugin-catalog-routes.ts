import type express from 'express'
import { CatalogError, type PluginCatalog } from '../plugins/catalog.ts'
import type { PluginInstaller } from '../plugins/installer.ts'
import { PackageError } from '../plugins/package.ts'
import { describeStaged } from './plugin-staged.ts'
import { requireServerAdmin } from './profile-routes.ts'

const STATUS: Record<string, number> = {
  catalog_unavailable: 502,
  download_failed: 502,
  not_found: 404,
  checksum_mismatch: 409
}

// Serveur › Plugins › Disponibles. The list shows each entry by its name, translated names and version; « Installer »
// downloads the file, checks its sha256, then reads it as a package sent by hand: the same questions follow.
export const mountCatalogRoutes = (router: express.Router, catalog: PluginCatalog, installer: PluginInstaller) => {
  router.get('/catalog', requireServerAdmin, async (_request, response) => {
    try {
      const entries = await catalog.list()
      response.json({
        plugins: entries.map(({ id, name, description, translations, version, repo }) => ({
          id,
          name,
          description,
          translations,
          version,
          repo
        }))
      })
    } catch (error) {
      if (!(error instanceof CatalogError)) throw error
      response.status(STATUS[error.code] ?? 502).json({ error: error.code })
    }
  })

  router.post('/catalog/:id/stage', requireServerAdmin, async (request: express.Request<{ id: string }>, response) => {
    try {
      const { entry, bytes } = await catalog.download(request.params.id)
      const staged = await installer.stage(bytes)
      // The file must be the plugin and version the entry names, whatever its sha256 says.
      if (staged.manifest.id !== entry.id || staged.manifest.version !== entry.version) {
        response.status(400).json({ error: 'invalid_manifest' })
        return
      }
      response.status(201).json(describeStaged(staged))
    } catch (error) {
      if (error instanceof CatalogError) response.status(STATUS[error.code] ?? 502).json({ error: error.code })
      else if (error instanceof PackageError) response.status(400).json({ error: error.code, detail: error.detail })
      else throw error
    }
  })
}
