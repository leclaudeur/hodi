// What a plugin's server part is typed against: `import type { ServerPlugin } from '@hodi-app/plugin-sdk/server'`.
// Types only: a plugin's server.js runs in its sandbox and never imports Hodi's own modules; it gets what it needs
// through its ctx.
export type {
  PluginAccount,
  PluginAiAction,
  PluginCaller,
  PluginContext,
  PluginDatabase,
  PluginFeedArticle,
  PluginHandler,
  PluginRequest,
  PluginResponse,
  PluginRoutes,
  PluginTask,
  PluginZipEntry,
  PublicHandler,
  PublicResponse,
  PublicRequest,
  PublicRoutes,
  ServerPlugin,
  SqlValue
} from '../server/plugins/api.ts'
export type { PluginArticle } from '../server/plugins/articles.ts'
export type { Manifest, Permissions, PluginFeed, SettingSpec, SettingValues } from '../server/plugins/manifest.ts'
export type { PublicMeta, PublicPages, PublicRoute } from '../server/plugins/public-page.ts'
