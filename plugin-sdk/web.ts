// What a plugin's web part is typed against, published as @hodi-app/plugin-sdk/web. Types only: at run time the page
// hands these to web.js (web/src/plugins/host.ts), which imports them as 'hodi:sdk' (see hodi-sdk.d.ts).
export * from '../web/src/plugins/sdk.ts'
