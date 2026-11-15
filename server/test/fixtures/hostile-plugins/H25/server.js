// H25: No redirect status. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'GET /302': async () => ({ status: 302, body: { location: 'https://evil.example' } }),
    'GET /301': async () => ({ status: 301 }),
    'GET /999': async () => ({ status: 999 }),
    'GET /101': async () => ({ status: 101 })
  }
}
