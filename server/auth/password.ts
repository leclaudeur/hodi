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

// One of OWASP's recommended scrypt settings (N=2^15, r=8, p=3): about 32 MiB of memory and three times the work of
// p=1 per check. OWASP's N=2^17 setting is as strong but takes 128 MiB a check, which the container's 256 MiB cannot
// hold twice at once.
export const DEFAULT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 3 }
// Checks running at once, whoever asks: more wait their turn, so that a flood of sign-ins (the decoy for an unknown
// e-mail hashes too) never takes more than 64 MiB of the server's memory.
export const MAX_RUNNING = 2

interface ParsedHash {
  params: ScryptParams
  salt: Buffer
  hash: Buffer
}

let running = 0
const waiting: (() => void)[] = []

// The next check starts when one ends.
const inTurn = async <T>(work: () => Promise<T>): Promise<T> => {
  if (running >= MAX_RUNNING) await new Promise<void>(resolve => waiting.push(resolve))
  else running += 1
  try {
    return await work()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else running -= 1
  }
}

// The highest number of checks that ran at once, for tests.
let mostRunning = 0
export const mostRunningChecks = () => mostRunning

const derive = (password: string, salt: Buffer, params: ScryptParams) =>
  inTurn(() => {
    mostRunning = Math.max(mostRunning, running)
    return scryptOnce(password, salt, params)
  })

const scryptOnce = (password: string, salt: Buffer, { N, r, p }: ScryptParams) =>
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

// A hash made with weaker settings than today's: hashed again, from the password just typed, when it is right.
export const needsRehash = (encoded: string, params: ScryptParams = DEFAULT_PARAMS) => {
  const { params: current } = parsePasswordHash(encoded)
  // The work a guess takes: scrypt's cost grows with N * r * p.
  return current.N * current.r * current.p < params.N * params.r * params.p || current.N < params.N
}
