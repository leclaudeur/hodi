import { generateKeyPairSync, sign } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { packageDigest } from '../../plugins/package.ts'

// A key made for the tests that need a verified plugin: accounts, households, sign-ins, mail and notifications are
// refused to an unsigned one.
const testKey = generateKeyPairSync('ed25519')
export const TEST_TRUSTED_KEYS = [testKey.publicKey.export({ type: 'spki', format: 'pem' }).toString()]

// Signs a plugin folder as it is now: write its files first.
export const signTestFolder = (root: string) =>
  writeFileSync(path.join(root, 'signature'), sign(null, packageDigest(root), testKey.privateKey).toString('base64'))
