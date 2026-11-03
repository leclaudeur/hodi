import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

// Stored format: scrypt:<N>:<r>:<p>:<salt>:<hash>, salt and hash in base64url.
// No "$" separators, so the value survives Docker Compose variable interpolation.
const PREFIX = 'scrypt'
const KEY_LENGTH = 64
const SALT_LENGTH = 16
const MAX_COST = 2 ** 20

export interface ScryptParams {
  N: number
  r: number
  p: number
}

// About 32 MiB of memory and roughly 100 ms per check on the home server CPU.
export const DEFAULT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1 }

interface ParsedHash {
  params: ScryptParams
  salt: Buffer
  hash: Buffer
}

const derive = (password: string, salt: Buffer, { N, r, p }: ScryptParams) =>
  new Promise<Buffer>((resolve, reject) => {
    // maxmem must exceed 128 * N * r, which Node's 32 MiB default does not at N = 2^15.
    scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r }, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  })

export const hashPassword = async (password: string, params: ScryptParams = DEFAULT_PARAMS) => {
  const salt = randomBytes(SALT_LENGTH)
  const hash = await derive(password, salt, params)
  return [PREFIX, params.N, params.r, params.p, salt.toString('base64url'), hash.toString('base64url')].join(':')
}

export const parsePasswordHash = (encoded: string): ParsedHash => {
  const parts = encoded.split(':')
  const [prefix, n, r, p, salt, hash] = parts

  if (parts.length !== 6 || prefix !== PREFIX || !salt || !hash) {
    throw new Error('Password hash must look like scrypt:N:r:p:salt:hash')
  }

  const params = { N: Number(n), r: Number(r), p: Number(p) }
  const isPowerOfTwo = Number.isInteger(params.N) && params.N > 1 && (params.N & (params.N - 1)) === 0

  if (!isPowerOfTwo || params.N > MAX_COST || !Number.isInteger(params.r) || params.r < 1 || params.r > 32) {
    throw new Error('Password hash has invalid scrypt cost parameters')
  }

  if (!Number.isInteger(params.p) || params.p < 1 || params.p > 16) {
    throw new Error('Password hash has an invalid scrypt parallelization parameter')
  }

  const decodedHash = Buffer.from(hash, 'base64url')

  if (decodedHash.length !== KEY_LENGTH) {
    throw new Error('Password hash has an unexpected length')
  }

  return { params, salt: Buffer.from(salt, 'base64url'), hash: decodedHash }
}

export const verifyPassword = async (password: string, encoded: string) => {
  const { params, salt, hash } = parsePasswordHash(encoded)
  const candidate = await derive(password, salt, params)

  return timingSafeEqual(candidate, hash)
}
