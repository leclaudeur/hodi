// An account's @identifier: unique on the server, for friends and mentions. Lower-case letters, digits, a dot or an
// underscore, nothing else, so that it reads the same in every language and every font. Its lengths come from
// config.yml (accounts.handle_min_length, handle_max_length), which the server and the app each read their own way.

export const handleRules = ({
  handleMinLength,
  handleMaxLength
}: {
  handleMinLength: number
  handleMaxLength: number
}) => {
  const pattern = new RegExp(`^[a-z0-9._]{${handleMinLength},${handleMaxLength}}$`)

  // What was typed, without its "@" and in lower case, or null when it cannot be an identifier.
  const cleanHandle = (value: unknown) => {
    if (typeof value !== 'string') return null
    const handle = value.trim().replace(/^@/, '').toLowerCase()
    return pattern.test(handle) ? handle : null
  }

  // A name or an e-mail's first part as an identifier: accents dropped, anything else left out; '' when nothing is
  // left.
  const handleFrom = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9._]/g, '')
      .slice(0, handleMaxLength)

  // What an identifier made from a text starts from: long enough, and never empty.
  const handleBase = (text: string) => (handleFrom(text) || 'reader').padEnd(handleMinLength, '_')

  return { cleanHandle, handleFrom, handleBase }
}
