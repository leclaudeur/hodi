import { createHash, createPublicKey, verify } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { extract } from 'tar'
import { type Manifest, parseManifest } from './manifest.ts'

// A plugin package (.hodi-plugin) is a gzipped tar of the plugin's folder: plugin.json at its root, then server.js,
// web.js, locales/ and assets/ as the plugin needs. A package from the catalogue, or one of the maintainer's
// private plugins, also holds a `signature` file over everything else.

// Generous enough for a plugin with pictures (the kids' island), small enough for the data volume.
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024
export const MAX_UNPACKED_BYTES = 150 * 1024 * 1024
const MAX_FILES = 2000
const SIGNATURE_FILE = 'signature'

// code: what the interface says (too_big, not_a_package, invalid_manifest); detail: why, for the admin and the log.
export class PackageError extends Error {
  readonly code: 'too_big' | 'not_a_package' | 'invalid_manifest'
  readonly detail: string | null

  constructor(code: PackageError['code'], detail: string | null = null) {
    super(detail ? `${code}: ${detail}` : code)
    this.code = code
    this.detail = detail
  }
}

export interface UnpackedPackage {
  manifest: Manifest
  // Whether a trusted key signed exactly these files.
  signed: boolean
  bytes: number
}

// The public keys whose signature Hodi trusts (ed25519, PEM): a package signed by one of them is "Vérifié", an
// official plugin. Only the maintainer holds the private key, so only the maintainer's plugins carry that badge.
export const TRUSTED_KEYS: readonly string[] = [
  // The maintainer's key (2026-11-05).
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAiiSkNmOjDF1MrOCwcYjBxzwk8sa0qMq/LTYCug/r06w=
-----END PUBLIC KEY-----
`
]

// Every file but the signature, in a fixed order, with its SHA-256: what a signature covers.
export const packageDigest = (root: string) => {
  const lines: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name)
      const relative = path.relative(root, file).split(path.sep).join('/')
      if (lstatSync(file).isDirectory()) walk(file)
      else if (relative !== SIGNATURE_FILE) {
        lines.push(`${relative}\t${createHash('sha256').update(readFileSync(file)).digest('hex')}`)
      }
    }
  }
  walk(root)
  return Buffer.from(lines.join('\n'))
}

// The trusted key that signed the folder as it is now, as `key:<SHA-256 of the key>`; null when none did. Checked
// again each time Hodi loads its plugins.
export const signerOf = (root: string, keys: readonly string[]): string | null => {
  let signature: Buffer
  try {
    signature = Buffer.from(readFileSync(path.join(root, SIGNATURE_FILE), 'utf8').trim(), 'base64')
  } catch {
    return null
  }
  const digest = packageDigest(root)
  const key = keys.find(candidate => {
    try {
      return verify(null, digest, candidate, signature)
    } catch {
      return false
    }
  })
  if (key === undefined) return null
  const der = createPublicKey(key).export({ type: 'spki', format: 'der' })
  return `key:${createHash('sha256').update(der).digest('hex')}`
}

export const isSigned = (root: string, keys: readonly string[]) => signerOf(root, keys) !== null

// Who a plugin's data belongs to: the key that signed it, so that its official updates keep their data, or else
// these exact files. Another plugin that only takes the same id never gets that data.
export const ownerOf = (root: string, keys: readonly string[]) =>
  signerOf(root, keys) ?? `unsigned:${createHash('sha256').update(packageDigest(root)).digest('hex')}`

// Unpacks a package into an empty folder and reads what it is. Only plain files and folders are kept, inside the
// folder: links, devices and paths that climb out are refused, and so is a package too big once unpacked.
export const unpackPackage = async (
  bytes: Buffer,
  into: string,
  keys: readonly string[] = TRUSTED_KEYS
): Promise<UnpackedPackage> => {
  if (bytes.length > MAX_PACKAGE_BYTES) throw new PackageError('too_big')
  mkdirSync(into, { recursive: true })
  const packageFile = path.join(into, '..', `${path.basename(into)}.tgz`)
  writeFileSync(packageFile, bytes)

  let files = 0
  let unpacked = 0
  let refused: string | null = null
  try {
    await extract({
      file: packageFile,
      cwd: into,
      strict: true,
      // node-tar already strips leading slashes and refuses paths that climb out with "..".
      preservePaths: false,
      filter: (entryPath, entry) => {
        const type = 'type' in entry ? entry.type : null
        if (type !== 'File' && type !== 'Directory') {
          refused ??= `${entryPath} is not a plain file`
          return false
        }
        files += 1
        unpacked += entry.size ?? 0
        if (files > MAX_FILES || unpacked > MAX_UNPACKED_BYTES) {
          refused ??= 'too_big'
          return false
        }
        return true
      }
    })
  } catch {
    throw new PackageError('not_a_package')
  } finally {
    rmSync(packageFile, { force: true })
  }
  if (refused === 'too_big') throw new PackageError('too_big')
  if (refused) throw new PackageError('not_a_package', refused)

  let manifest: Manifest
  try {
    manifest = parseManifest(JSON.parse(readFileSync(path.join(into, 'plugin.json'), 'utf8')))
  } catch (error) {
    throw new PackageError('invalid_manifest', error instanceof Error ? error.message : null)
  }

  return { manifest, signed: isSigned(into, keys), bytes: unpacked }
}
