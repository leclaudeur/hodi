// What a plugin's SQL may do in its own database: read and write its own tables, and shape them. Never reach another
// database file (ATTACH, VACUUM INTO), change how SQLite runs (PRAGMA) or load code (extensions are off besides).
// One statement at a time: a second one after a ";" is refused, so nothing rides behind an allowed one.

export class SqlRefused extends Error {}

// The first words a statement may start with.
const ALLOWED = [
  ['SELECT'],
  ['WITH'],
  ['VALUES'],
  ['INSERT'],
  ['REPLACE'],
  ['UPDATE'],
  ['DELETE'],
  ['CREATE', 'TABLE'],
  ['CREATE', 'INDEX'],
  ['CREATE', 'UNIQUE', 'INDEX'],
  ['ALTER', 'TABLE'],
  ['DROP', 'TABLE'],
  ['DROP', 'INDEX'],
  ['BEGIN'],
  ['COMMIT'],
  ['END'],
  ['ROLLBACK'],
  ['SAVEPOINT'],
  ['RELEASE']
]

// Hodi's own bookkeeping in the plugin's database (its migrations): the plugin cannot rewrite it.
export const RESERVED_PREFIX = 'hodi_'

// Where a comment starting at index ends, or null when none starts there.
const commentEnd = (sql: string, index: number) => {
  if (sql[index] === '-' && sql[index + 1] === '-') {
    const end = sql.indexOf('\n', index)
    return end === -1 ? sql.length : end + 1
  }
  if (sql[index] === '/' && sql[index + 1] === '*') {
    const end = sql.indexOf('*/', index + 2)
    return end === -1 ? sql.length : end + 2
  }
  return null
}

const QUOTES = ["'", '"', '`', '[']

// The index of the quote that closes the string or name opening at index.
const quoteEnd = (sql: string, index: number) => {
  const close = sql[index] === '[' ? ']' : sql[index]
  let end = index + 1
  while (end < sql.length) {
    if (sql[end] !== close) end += 1
    // A doubled quote is a quote inside the string.
    else if (close !== ']' && sql[end + 1] === close) end += 2
    else break
  }
  return end
}

// The statement's words outside strings, quoted names and comments, upper case; null when more than one statement.
const wordsOf = (sql: string): string[] | null => {
  const words: string[] = []
  let index = 0
  let ended = false
  while (index < sql.length) {
    const char = sql[index]!
    const afterComment = /\s/.test(char) ? index + 1 : commentEnd(sql, index)
    if (afterComment !== null) {
      index = afterComment
      continue
    }
    // Anything but blanks and comments after the ";": a second statement.
    if (ended) return null
    if (char === ';') {
      ended = true
      index += 1
    } else if (QUOTES.includes(char)) {
      const end = quoteEnd(sql, index)
      if (char !== "'") words.push(`"${sql.slice(index + 1, end).toUpperCase()}"`)
      index = end + 1
    } else if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(index))!
      words.push(match[0].toUpperCase())
      index += match[0].length
    } else {
      index += 1
    }
  }
  return words
}

// ATTACH and VACUUM only begin a statement, but a name or keyword anywhere is checked too, out of caution.
const checkNames = (words: string[]) => {
  for (const word of words) {
    const bare = word.replace(/^"|"$/g, '')
    if (['ATTACH', 'DETACH', 'VACUUM', 'PRAGMA', 'LOAD_EXTENSION'].includes(word)) {
      throw new SqlRefused(`not_allowed:${word}`)
    }
    // pragma_… are the table-valued PRAGMA functions; sqlite_… SQLite's own tables and functions.
    if (bare.startsWith(RESERVED_PREFIX.toUpperCase()) || bare.startsWith('SQLITE_') || bare.startsWith('PRAGMA_')) {
      throw new SqlRefused(`reserved_name:${bare.toLowerCase()}`)
    }
  }
}

// Throws SqlRefused for a statement the plugin may not run.
export const checkPluginSql = (sql: unknown): string => {
  if (typeof sql !== 'string' || sql.length === 0 || sql.length > 100_000) throw new SqlRefused('invalid_sql')
  const words = wordsOf(sql)
  if (!words) throw new SqlRefused('one_statement_only')
  if (words.length === 0) throw new SqlRefused('invalid_sql')
  const allowed = ALLOWED.some(start => start.every((word, at) => words[at] === word))
  if (!allowed) throw new SqlRefused(`not_allowed:${words.slice(0, 2).join(' ')}`)
  checkNames(words)
  return sql
}
