// No household yet (« Plus tard » at the setup): the device is the server's admin's, in /server alone, so nothing
// leads back to the app. Set from the session before the app shows anything.
let serverOnly = false

export const setServerOnly = (value: boolean) => {
  serverOnly = value
}

export const isServerOnly = () => serverOnly
