// The checks the routes share on what a client sends.

export const MAX_WORDS = 50
export const MAX_WORD_LENGTH = 60
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const isString = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength

export const wordList = (value: unknown) =>
  Array.isArray(value) && value.length <= MAX_WORDS && value.every(word => isString(word, MAX_WORD_LENGTH))
    ? (value as string[])
    : null

export const isTimeZone = (value: unknown): value is string => {
  if (!isString(value, 64)) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value })
    return true
  } catch {
    return false
  }
}
