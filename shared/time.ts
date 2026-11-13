// Durations in milliseconds, for the server and the web app alike.
export const SECOND_MS = 1000
export const MINUTE_MS = 60 * SECOND_MS
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS
export const WEEK_MS = 7 * DAY_MS

// A young profile's app says it is on screen this often; the server judges the time spent on it.
export const HEARTBEAT_MS = 30 * SECOND_MS
