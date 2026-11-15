// H6: An endless chain of promises is stopped. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'GET /jobs': async () => {
      const again = () => Promise.resolve().then(again)
      again()
      return new Promise(() => {})
    }
  }
}
