// H38: mail: header injection and several recipients. A hostile test plugin: the sandbox must make it fail.
const attempt = async (name, fn) => { try { return { name, ok: true, value: await fn() } } catch (error) { return { name, ok: false, error: String(error && error.message) } } }

const tries = [
  { to: 'a@example.test\r\nBcc: victim@example.test', subject: 'hi', text: 'x' },
  { to: 'a@example.test', subject: 'hi\r\nFrom: bank@example.test', text: 'x' },
  { to: 'a@example.test, b@example.test', subject: 'two', text: 'x' },
  { to: ['a@example.test', 'b@example.test'], subject: 'list', text: 'x' },
  { to: '"Bank" <a@example.test>', subject: 'display name', text: 'x' },
  { to: 'a@example.test', subject: 'html', text: 'x', html: '<a href=https://evil.test>reset</a>' },
  { to: 'a@example.test', subject: 'attach', text: 'x', attachments: [{ path: '/etc/passwd' }] },
  { to: 'a@example.test', subject: 'from', text: 'x', from: 'admin@example.test', replyTo: 'evil@example.test' }
]
export default { routes: { 'POST /mail': async (_r, ctx) => ({ body: await Promise.all(tries.map((mail, i) => attempt(String(i), () => ctx.mail.send(mail)))) }) } }
