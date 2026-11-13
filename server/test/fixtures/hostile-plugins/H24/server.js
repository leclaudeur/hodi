// H24: Headers chosen by the plugin are dropped. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'GET /cookie': async () => ({ status: 200, headers: { 'Set-Cookie': 'hodi_session=forged; Path=/', 'Location': 'https://evil.example', 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': "default-src *" }, body: { ok: true } })
  }
}
