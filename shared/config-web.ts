import type { Config } from './config-schema.ts'

// The groups of config.yml the web app reads: only these are built into the page, so the server's own limits (sign-in
// lockouts, sandbox memory, blocked hosts…) stay out of what every visitor downloads.
export const WEB_GROUPS = [
  'accounts',
  'ai',
  'app',
  'children',
  'household',
  'myData',
  'passwords',
  'plugins',
  'profiles',
  'reading',
  'serverSettings',
  'shares',
  'sources',
  'twoFactor',
  'young'
] as const satisfies readonly (keyof Config)[]

export type WebConfig = Pick<Config, (typeof WEB_GROUPS)[number]>

export const webShare = (config: Config) =>
  Object.fromEntries(WEB_GROUPS.map(group => [group, config[group]])) as WebConfig
