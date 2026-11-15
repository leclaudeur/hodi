// "Mac · Safari", "iPhone · Hodi (PWA)": a device as its browser describes itself, for Réglages > Compte et données.
// app: what to call a browser this does not know; standalone: the app installed on the home screen (this device
// only, the others' browsers do not say).
// The first that matches names the device, then the browser.
const DEVICES: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Mac/, 'Mac'],
  [/Windows/, 'PC Windows']
]
const BROWSERS: [RegExp, string][] = [
  [/Firefox\//, 'Firefox'],
  [/Edg\//, 'Edge'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari']
]

const firstMatch = (agent: string, names: [RegExp, string][]) => names.find(([pattern]) => pattern.test(agent))?.[1]

export const deviceLabel = (agent: string, { standalone = false, browser = 'Navigateur' } = {}) => {
  const device = firstMatch(agent, DEVICES) ?? 'Linux'
  const app = standalone ? 'Hodi (PWA)' : (firstMatch(agent, BROWSERS) ?? browser)
  return `${device} · ${app}`
}
