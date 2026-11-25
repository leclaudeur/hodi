import semver from 'semver'
import { OUTDATED_API } from './manifest.ts'

// The plugin SDK this Hodi comes with (plugin-sdk/package.json, released together; a test keeps them equal). Its
// build writes its version into each plugin.json as `sdk`.
export const PLUGIN_SDK = '1.0.0-beta.7'
// The oldest SDK whose plugins still run here, raised when Hodi changes what plugins rely on within the same API. A
// plugin without `sdk` was built before the SDK wrote it: it is as outdated as one written for API 1.
export const OLDEST_PLUGIN_SDK = '1.0.0-beta.7'
// The error of a plugin built with a newer SDK than this Hodi's: it may call what Hodi does not have yet.
export const NEWER_SDK = 'newer_sdk'

// Why a plugin built with this SDK cannot run here, or null.
export const sdkRefusal = (sdk: string | null) => {
  if (sdk == null || semver.lt(sdk, OLDEST_PLUGIN_SDK)) return OUTDATED_API
  if (semver.gt(sdk, PLUGIN_SDK)) return NEWER_SDK
  return null
}
