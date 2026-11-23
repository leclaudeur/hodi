// config.yml's shape: every group, every key and what kind of value it holds. The file is the only place their values
// live; the code reads them as CONFIG (server/fixed-config.ts, web/src/lib/config.ts), durations in milliseconds and
// sizes in bytes.

import { PLUGIN_SCHEMA } from './config-schema-plugins.ts'

export type ConfigKind = 'count' | 'ratio' | 'duration' | 'size' | 'text' | 'list'

export const CONFIG_SCHEMA = {
  signIn: {
    failuresPerClient: 'count',
    failureWindow: 'duration',
    failuresServerWide: 'count',
    trackedClients: 'count',
    secondStepWindow: 'duration',
    secondStepTries: 'count',
    secondStepTickets: 'count',
    sessionLifetime: 'duration',
    accountsPerDevice: 'count',
    recentSignIn: 'duration',
    hashingAtOnce: 'count'
  },
  passwords: { minLength: 'count', maxLength: 'count' },
  profilePin: { failures: 'count', failuresServerWide: 'count' },
  twoFactor: { recoveryCodes: 'count', setupLifetime: 'duration' },
  codes: {
    signInLifetime: 'duration',
    resetLifetime: 'duration',
    resetInterval: 'duration',
    requestKept: 'duration'
  },
  accounts: {
    emailMaxLength: 'count',
    loginMaxLength: 'count',
    handleMinLength: 'count',
    handleMaxLength: 'count',
    handleChangeDays: 'count',
    handleChecksPerMinute: 'count',
    copiesPerMinute: 'count',
    profileDeviceIdle: 'duration',
    deviceSeenStep: 'duration',
    userAgentMaxLength: 'count',
    onlineFor: 'duration'
  },
  profiles: { nameMaxLength: 'count', photoMaxSize: 'size', photoSide: 'count' },
  children: { max: 'count', createsPerMinute: 'count', parents: 'count' },
  invitations: { nameMaxLength: 'count', mailsPerDay: 'count', serverMailsPerDay: 'count' },
  household: { nameMaxLength: 'count' },
  mail: { hostMaxLength: 'count', userMaxLength: 'count', passwordMaxLength: 'count', timeout: 'duration' },
  requests: { perMinute: 'count' },
  database: { busyTimeout: 'duration' },
  backups: { checkEvery: 'duration', forgetMargin: 'duration' },
  blocks: { sharedHosts: 'list' },
  feeds: {
    cacheFor: 'duration',
    errorCacheFor: 'duration',
    forcedRefreshEvery: 'duration',
    atOnce: 'count',
    checksAtOnce: 'count',
    backgroundChecksAtOnce: 'count',
    summaryLength: 'count'
  },
  fetch: {
    redirects: 'count',
    youtubePageMaxSize: 'size',
    videoPageMaxSize: 'size',
    defaultTimeout: 'duration',
    defaultMaxSize: 'size',
    textTimeout: 'duration',
    findTimeout: 'duration',
    picturesTimeout: 'duration',
    packagesTimeout: 'duration',
    pluginTimeout: 'duration',
    pluginMaxSize: 'size'
  },
  sources: {
    linkMaxLength: 'count',
    foundKeptFor: 'duration',
    aiSuggestions: 'count',
    readerSample: 'count',
    nameMaxLength: 'count',
    descriptionMaxLength: 'count',
    nameSectionWords: 'count',
    namePartWords: 'count',
    topicsMax: 'count',
    readersShownFrom: 'count',
    reviewAskAgainAfter: 'duration',
    reportsPerHour: 'count',
    reportIgnoredFor: 'duration'
  },
  sourceIcons: { keptFor: 'duration', missingKeptFor: 'duration', maxSize: 'size', candidates: 'count' },
  lists: {
    topicWindow: 'duration',
    frontPageWindow: 'duration',
    listenWindow: 'duration',
    topicPageSize: 'count',
    topicMax: 'count',
    emptyDaysMax: 'count',
    frontPageSize: 'count'
  },
  stories: {
    gap: 'duration',
    analysesKept: 'count',
    sharedWords: 'count',
    sharedRatio: 'ratio',
    sameWordsRatio: 'ratio',
    titleKeysKept: 'count'
  },
  reader: {
    textMinLength: 'count',
    charactersPerMinute: 'count',
    authorMaxLength: 'count',
    articlesCached: 'count',
    templateSample: 'count',
    verdictsKept: 'count',
    workersIdle: 'duration'
  },
  images: {
    quality: 'count',
    previewQuality: 'count',
    previewWidth: 'count',
    maxSize: 'size',
    maxPixels: 'count',
    downloadsAtOnce: 'count',
    warmEvery: 'duration',
    warmBatch: 'count',
    warmWindow: 'duration'
  },
  videos: { shortMaxSeconds: 'count', durationRetry: 'duration' },
  search: { queryMaxLength: 'count', results: 'count', storedRows: 'count', checks: 'count' },
  trends: { window: 'duration', cacheFor: 'duration', minArticles: 'count', maxWords: 'count' },
  engagement: {
    window: 'duration',
    minHistory: 'duration',
    minArticles: 'count',
    minProfileReads: 'count',
    lowShareOfMedian: 'ratio',
    lowRateFloor: 'ratio',
    channelMinItems: 'count',
    channelMinProfileReads: 'count'
  },
  retention: {
    read: 'duration',
    readings: 'duration',
    shares: 'duration',
    seenStories: 'duration',
    aiCalls: 'duration',
    videoDurations: 'duration',
    dailySummaries: 'count',
    visitsDays: 'count',
    readingDays: 'count',
    activeDays: 'count'
  },
  inbox: { items: 'count', handledKeptFor: 'duration', pageSize: 'count' },
  reading: {
    historyWindow: 'duration',
    historyMax: 'count',
    resumeWindow: 'duration',
    resumeMax: 'count',
    resumeFrom: 'ratio',
    resumeUntil: 'ratio',
    doneAt: 'ratio',
    doneTime: 'ratio',
    maxTime: 'count',
    wordsPerMinute: 'count',
    maxMinutesPerDay: 'count'
  },
  myData: {
    savedMax: 'count',
    readMax: 'count',
    importSaved: 'count',
    importRead: 'count',
    importReadings: 'count',
    importArticleSize: 'size',
    listMax: 'count',
    stringMax: 'count'
  },
  mutedWords: { max: 'count', wordMaxLength: 'count' },
  game: {
    dailyArticles: 'count',
    dailyVideos: 'count',
    dailyAlerts: 'count',
    dailyShares: 'count',
    dailyReactions: 'count',
    lateSync: 'duration',
    earlyHour: 'count',
    lateHour: 'count'
  },
  shares: {
    noteMaxLength: 'count',
    lookupsPerMinute: 'count',
    reportsPerDay: 'count',
    reportHandledKeptFor: 'duration'
  },
  young: {
    dailyMinutesMin: 'count',
    dailyMinutesMax: 'count',
    dailyMinutesStep: 'count',
    dailyMinutesDefault: 'count',
    explainPerDayMax: 'count',
    explainPerDayDefault: 'count',
    pendingRequests: 'count',
    idsMax: 'count',
    warningBefore: 'duration'
  },
  ai: {
    defaultModel: 'text',
    requestTimeout: 'duration',
    maxTokens: 'count',
    keyCheckTimeout: 'duration',
    callsPerMinute: 'count',
    keyChecksPerMinute: 'count',
    questionMaxLength: 'count',
    summaryPoints: 'count',
    summarySearches: 'count',
    summaryContinuations: 'count',
    summarySuggested: 'count',
    summariesCached: 'count',
    summaryKeptFor: 'duration',
    dailySummaryMinAge: 'duration',
    dailySummaryMinStories: 'count',
    dailySummaryMaxLength: 'count'
  },
  alerts: {
    checkEvery: 'duration',
    subjectCooldown: 'duration',
    perDay: 'count',
    articleMaxAge: 'duration',
    devices: 'count',
    knownIds: 'count',
    previewLength: 'count'
  },
  serverNotices: { devices: 'count' },
  weeklyReport: { sendHour: 'count', checkEvery: 'duration' },
  serverSettings: {
    articleDaysMin: 'count',
    articleDaysMax: 'count',
    articleDaysDefault: 'count',
    videoDaysMin: 'count',
    videoDaysMax: 'count',
    videoDaysDefault: 'count',
    textDaysMin: 'count',
    textDaysMax: 'count',
    textDaysDefault: 'count',
    backupCopiesMin: 'count',
    backupCopiesMax: 'count',
    backupCopiesDefault: 'count',
    maxSourcesMin: 'count',
    maxSourcesMax: 'count',
    maxSourcesDefault: 'count'
  },
  ...PLUGIN_SCHEMA,
  app: {
    frontPagePollEvery: 'duration',
    frontPagePolls: 'count',
    frontPageStaleAfter: 'duration',
    dayFeedPollEvery: 'duration',
    dayFeedPolls: 'count',
    dayFeedStaleAfter: 'duration',
    dailySummaryPollEvery: 'duration',
    dailySummaryPolls: 'count',
    followedPollEvery: 'duration',
    followedPolls: 'count',
    followedVideoWindow: 'duration',
    searchPollEvery: 'duration',
    searchPolls: 'count',
    searchDebounce: 'duration',
    searchMinLength: 'count',
    userStateRefreshAfter: 'duration',
    listenStaleAfter: 'duration',
    offlineKept: 'count',
    offlineStartDelay: 'duration',
    savedTexts: 'count',
    summaries: 'count',
    summariesMaxAge: 'duration',
    recentSearches: 'count',
    seenStories: 'count',
    seenStoriesSendAfter: 'duration',
    photoSide: 'count',
    photoQuality: 'ratio',
    photoPickedMaxSize: 'size',
    handleCheckDelay: 'duration',
    warmDelay: 'duration',
    speechKeepAlive: 'duration',
    dailySummaryFreshFor: 'duration',
    restartWait: 'duration'
  }
} as const satisfies Record<string, Record<string, ConfigKind>>

type ValueOf<K> = K extends 'text' ? string : K extends 'list' ? string[] : number

type Schema = typeof CONFIG_SCHEMA

export type Config = { readonly [G in keyof Schema]: { readonly [K in keyof Schema[G]]: ValueOf<Schema[G][K]> } }
