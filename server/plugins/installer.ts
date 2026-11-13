import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { type ManifestTranslations, manifestTranslations } from './manifest-texts.ts'
import { type Manifest, signedOnlyAsked } from './manifest.ts'
import { TRUSTED_KEYS, unpackPackage } from './package.ts'

// Installing a plugin takes two steps, so the admin sees what a package is before any of it is kept:
//   1. stage: the package is unpacked apart, in plugins/.incoming/<token>/, and described;
//   2. install: the staged folder takes the plugin's place (an update replaces the old folder whole), then Hodi
//      restarts to load it.
// Removing a plugin deletes its folder only: its settings, its tables and data/plugin-data/<id>/ stay, so installing
// it again finds them.

const STAGED_FOR_MS = 15 * 60 * 1000

export interface Staged {
  token: string
  manifest: Manifest
  // Its name and description in other languages, for the dialog that shows it before the install.
  translations: ManifestTranslations
  signed: boolean
  bytes: number
  // The version installed now, when this package replaces it.
  replaces: string | null
}

export class PluginInstaller {
  readonly #dir: string
  readonly #keys: readonly string[]
  readonly #now: () => number
  readonly #installedVersion: (id: string) => string | null
  readonly #staged = new Map<string, Staged & { at: number }>()

  constructor({
    dir,
    keys = TRUSTED_KEYS,
    now = Date.now,
    installedVersion
  }: {
    dir: string
    keys?: readonly string[]
    now?: () => number
    installedVersion: (id: string) => string | null
  }) {
    this.#dir = dir
    this.#keys = keys
    this.#now = now
    this.#installedVersion = installedVersion
    // Whatever a stop left half done.
    rmSync(this.#incoming, { recursive: true, force: true })
    rmSync(this.#trash, { recursive: true, force: true })
  }

  get #incoming() {
    return path.join(this.#dir, '.incoming')
  }

  get #trash() {
    return path.join(this.#dir, '.trash')
  }

  #forget(token: string) {
    this.#staged.delete(token)
    rmSync(path.join(this.#incoming, token), { recursive: true, force: true })
  }

  #prune() {
    const now = this.#now()
    for (const [token, staged] of this.#staged) if (now - staged.at > STAGED_FOR_MS) this.#forget(token)
  }

  async stage(bytes: Buffer): Promise<Staged> {
    this.#prune()
    const token = randomBytes(16).toString('hex')
    const into = path.join(this.#incoming, token)
    try {
      const { manifest, signed, bytes: size } = await unpackPackage(bytes, into, this.#keys)
      const translations = manifestTranslations(into)
      const staged = {
        token,
        manifest,
        translations,
        signed,
        bytes: size,
        replaces: this.#installedVersion(manifest.id)
      }
      this.#staged.set(token, { ...staged, at: this.#now() })
      return staged
    } catch (error) {
      rmSync(into, { recursive: true, force: true })
      throw error
    }
  }

  // Puts a staged package in place. An unsigned one needs the admin's explicit yes, and never gets in when it asks for a
  // signed-only permission, unless « npx hodi-plugin dev » installs it (dev). Returns null when the token is unknown or
  // expired.
  install(
    token: string,
    { acceptUnsigned, dev = false }: { acceptUnsigned: boolean; dev?: boolean }
  ): Staged | 'unsigned' | 'signed_only' | null {
    this.#prune()
    const staged = this.#staged.get(token)
    if (!staged) return null
    if (!staged.signed && !dev && signedOnlyAsked(staged.manifest).length > 0) return 'signed_only'
    if (!staged.signed && !acceptUnsigned) return 'unsigned'

    const target = path.join(this.#dir, staged.manifest.id)
    mkdirSync(this.#trash, { recursive: true })
    const old = path.join(this.#trash, `${staged.manifest.id}-${token}`)
    if (existsSync(target)) renameSync(target, old)
    renameSync(path.join(this.#incoming, token), target)
    rmSync(old, { recursive: true, force: true })
    this.#staged.delete(token)

    const { token: done, manifest, translations, signed, bytes, replaces } = staged
    return { token: done, manifest, translations, signed, bytes, replaces }
  }

  // Removes a plugin's code. Returns false when it is not installed.
  remove(id: string): boolean {
    const target = path.join(this.#dir, id)
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(id) || !existsSync(target)) return false
    mkdirSync(this.#trash, { recursive: true })
    const old = path.join(this.#trash, `${id}-${randomBytes(8).toString('hex')}`)
    renameSync(target, old)
    rmSync(old, { recursive: true, force: true })
    return true
  }
}
