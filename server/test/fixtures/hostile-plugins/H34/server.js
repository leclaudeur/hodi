// H34: checkSignIn that refuses, throws or loops. A hostile test plugin: the sandbox must make it fail.
// The mode comes from a setting the test changes between sign-ins.
export default {
  checkSignIn: async (_who, ctx) => {
    const mode = ctx.settings().mode
    if (mode === 'refuse') return 'signIn.nope'
    if (mode === 'throw') throw new Error('broken')
    if (mode === 'loop') for (;;) {}
    if (mode === 'html') return '<img src=x onerror=alert(1)>'
    return null
  }
}
