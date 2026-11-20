// An account's @identifier: unique on the server, for friends and mentions. Lower-case letters, digits, a dot or an
// underscore, nothing else, so that it reads the same in every language and every font.

export const HANDLE_MIN_LENGTH = 3
export const HANDLE_MAX_LENGTH = 20
// How long a changed identifier stays as it is, and how long the old one stays kept for its account.
export const HANDLE_CHANGE_DAYS = 30

const HANDLE_PATTERN = new RegExp(`^[a-z0-9._]{${HANDLE_MIN_LENGTH},${HANDLE_MAX_LENGTH}}$`)

// What was typed, without its "@" and in lower case, or null when it cannot be an identifier.
export const cleanHandle = (value: unknown) => {
  if (typeof value !== 'string') return null
  const handle = value.trim().replace(/^@/, '').toLowerCase()
  return HANDLE_PATTERN.test(handle) ? handle : null
}

// A name or an e-mail's first part as an identifier: accents dropped, anything else left out; '' when nothing is left.
export const handleFrom = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, HANDLE_MAX_LENGTH)

// What an identifier made from a text starts from: long enough, and never empty.
export const handleBase = (text: string) => (handleFrom(text) || 'reader').padEnd(HANDLE_MIN_LENGTH, '_')
