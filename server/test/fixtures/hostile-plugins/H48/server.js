// H48: ctx.accounts never returns a secret. A hostile test plugin: the sandbox must make it fail.
const secretish = /scrypt|\$[0-9a-z]+\$|hash|password|secret|token|code|session|generation/i
const scan = (value, path, found) => {
  if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) { if (secretish.test(key)) found.push(path + key); scan(inner, path + key + '.', found) }
  else if (typeof value === 'string' && value.length > 40) found.push(path + '(long string)')
  return found
}
export default {
  routes: {
    'GET /scan': async (_r, ctx) => {
      const found = []
      for (let id = 1; id <= 5; id++) scan(await ctx.accounts.get(id), 'get' + id + '.', found)
      scan(await ctx.accounts.findByEmail('antho@example.com'), 'find.', found)
      scan(await ctx.accounts.checkPassword('antho@example.com', 'une phrase de passe assez longue'), 'check.', found)
      return { body: { found } }
    }
  }
}
