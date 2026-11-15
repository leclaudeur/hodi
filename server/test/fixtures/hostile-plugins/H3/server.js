// H3: No WebAssembly, SharedArrayBuffer or Atomics inside the sandbox. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'GET /features': async () => ({
      body: {
        WebAssembly: typeof WebAssembly,
        SharedArrayBuffer: typeof SharedArrayBuffer,
        Atomics: typeof Atomics
      }
    })
  }
}
