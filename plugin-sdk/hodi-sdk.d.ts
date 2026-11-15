// A plugin imports Hodi's components from 'hodi:sdk', a name the build reads from the page. This gives that name the
// types of @hodi-app/plugin-sdk/web: a plugin lists "@hodi-app/plugin-sdk/hodi-sdk" in its tsconfig's "types".
declare module 'hodi:sdk' {
  export * from '@hodi-app/plugin-sdk/web'
}
