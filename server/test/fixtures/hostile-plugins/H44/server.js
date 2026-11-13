// H44: A binary response cannot claim an active content type. A hostile test plugin: the sandbox must make it fail.
const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
export default {
  routes: {
    'GET /html': async () => ({ headers: { 'Content-Type': 'text/html' }, body: bytes }),
    'GET /svg': async () => ({ headers: { 'Content-Type': 'image/svg+xml' }, body: bytes }),
    'GET /xml': async () => ({ headers: { 'Content-Type': 'application/xhtml+xml' }, body: bytes }),
    'GET /js': async () => ({ headers: { 'Content-Type': 'text/javascript' }, body: bytes }),
    'GET /pdf': async () => ({ headers: { 'Content-Type': 'application/pdf' }, body: bytes })
  }
}
