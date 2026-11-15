// H12: A slow onArticle never slows reading down. A hostile test plugin: the sandbox must make it fail.
export default {
  onArticle: async () => { const end = Date.now() + 2000; while (Date.now() < end) {} }
}
