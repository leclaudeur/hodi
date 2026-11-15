import type { Staged } from '../plugins/installer.ts'
import { signedOnlyAsked } from '../plugins/manifest.ts'

// A package read apart, as the add dialog shows it before the server admin installs it, whether it came as a file or
// from Hodi's registry.
export const describeStaged = ({ token, manifest, translations, signed, bytes, replaces }: Staged) => ({
  token,
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  translations,
  audience: manifest.audience,
  provides: manifest.provides,
  permissions: manifest.permissions,
  // The feeds it offers in « Sources proposées », by name and site.
  feeds: manifest.feeds.map(({ name, site }) => ({ name, site })),
  signed,
  // Signed-only permissions it asks for while unsigned: it cannot be installed, the dialog says why.
  signedOnly: signed ? [] : signedOnlyAsked(manifest),
  bytes,
  replaces
})
