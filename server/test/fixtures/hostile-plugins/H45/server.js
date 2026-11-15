// H45: A download name cannot inject a header. A hostile test plugin: the sandbox must make it fail.
const bytes = new Uint8Array([80, 75, 3, 4])
export default {
  routes: {
    'GET /crlf': async () => ({ headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="a.zip"\r\nSet-Cookie: hodi_session=x' }, body: bytes }),
    'GET /inline': async () => ({ headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'inline' }, body: bytes }),
    'GET /quotes': async () => ({ headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="../../evil\".zip"' }, body: bytes })
  }
}
