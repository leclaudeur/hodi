# Changelog

All notable changes to `@hodi-app/plugin-sdk` are documented in this file: what changes for people who write a Hodi
plugin.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Feature pull requests add their line under « Unreleased »
and never touch `version`; a small release pull request raises `version` and moves the lines under it, then the tag
`sdk-v<version>` publishes it.

## [Unreleased]

## [1.0.0-beta.1] - 2026-11-14

The API of Hodi 1.0, frozen until 1.0.0: the same as 0.6.1, so a plugin built for 0.6.1 keeps working. It comes out
with Hodi 1.0.0-beta.1, under npm's `beta` tag: `npm install @hodi-app/plugin-sdk@beta`.

## [0.6.1] - 2026-11-12

Public pages for the plugins that draw the signed-out screens. A plugin built for 0.6.0 keeps working.

### Added

- `publicPages` in `plugin.json`: the addresses a plugin drawing the signed-out screens opens to search engines, each
  with its language and, if it wants, its own `title`, `description` and 1200 × 630 `image` (else the plugin's
  `defaults`, translated in `locales/<lang>.json` under `publicPages`, else Hodi's own). Hodi writes them in the page's
  `<head>`, links each page's languages, and serves `robots.txt` and `sitemap.xml` once the server's address is set.

## [0.6.0] - 2026-11-11

Cards on Serveur › Vue d'ensemble, the server's households and accounts, and the password ring. A plugin built
for 0.5.3 keeps working; one that shows `PasswordGauge` gets the hint line only (see Changed).

### Added

- `overviewCards` in `definePlugin()`: a plugin's cards on Serveur › Vue d'ensemble, after « En ligne » and « Profils ».
  Each has an `id`, a `size` (`narrow`, `wide` or `full`: a third, two thirds or all of a computer's width) and a
  `component` that gets the period shown as `{ from, to }` (two days, `YYYY-MM-DD`, both included). A card that throws
  shows « Ce plugin n'a pas pu s'afficher » in its place.
- `useServerHouseholds()` and `useServerAccounts()` in `hodi:sdk`: Serveur › Foyers and Comptes, read only, for the
  server's admin (households with their adults and young; accounts with their household, creation and last use, never
  an e-mail). `null` until Hodi answers, and for anyone else.
- `OverviewCard` in `hodi:sdk`: a card of the overview, as Hodi's own (`title`, `count`, `aside`, then its content).
- `PasswordRing` in `hodi:sdk`: a new password's strength as a ring, for `PasswordField`'s new `lead` prop (in the
  lock's place), as on Hodi's own forms.

### Changed

- `PasswordGauge` no longer draws bars: it is the line under a new password while it is weak (« Faible · Encore 2
  caractères »), and nothing once it is strong. Put `PasswordRing` in the field to show the strength.

## [0.5.3] - 2026-11-11

Documentation only: nothing changes for a plugin built for 0.5.2.

### Added

- A plugin's name and description in other languages: `manifest.name` and `manifest.description` in
  `locales/<language>.json`. Hodi shows them wherever it names the plugin, and `plugin.json`'s own where a language has
  none. Give both in every language's file, even when they read the same.

## [0.5.2] - 2026-11-10

A fix for unsigned plugins, ahead of the next Hodi release. Nothing changes for a plugin built for 0.5.1.

### Fixed

- An unsigned plugin's `locales/*.json` load in Hodi: Serveur › Plugins names its settings with
  `settings.<key>` and `settings.<key>Hint`, as a signed one's, instead of the raw key. Its `web.js`, styles and
  assets are still never served.

## [0.5.1] - 2026-11-09

What Village still needed once 0.5.0 was out, and a test kit that works in a plugin's own repository. Nothing changes
for a plugin built for 0.5.0.

### Added

- An HTML page in a plugin's `assets/` (a demo, a preview) shows in an `<iframe>` of Hodi's page, sandboxed in an
  origin of its own, and talks to the plugin's page with `postMessage` only.
- `household.photo` in `ctx.households` (the address of the photo its admin set in Réglages › Foyer, or `null`) and
  `HouseholdAvatar` in `hodi:sdk`, round as a profile in « Qui lit ? », for a page such as « Quel foyer ? ».
- `ctx.serverSettings()` and `useServerSettings()` give `maxSources`: how many sources a household may follow, as set
  in Serveur › Contenu, or `null` for no limit.
- `crypto.getRandomValues` and `crypto.randomUUID` in the server part, for codes and tokens nobody can guess:
  `Math.random` was the only source of chance.
- `ctx.mail.appUrl()`: the server's address set in Serveur › E-mail, for a link in an e-mail (a waiting list's
  confirmation, an invitation).
- `who.accountId` in a route: the account signed in on the device, for `ctx.households.of(accountId)` (« Quel
  foyer ? », « Changer de foyer »).
- `Checkbox`, `PasswordField`, `PasswordGauge` and `Segmented` in `hodi:sdk`: the round check of « J'ai au moins 13 ans », the
  password's pill with its eye and the strength bars, for a form that makes an account, and the pill of a
  SettingRow's choice.
- `MoreRow`, `PinField`, `AgeCheckbox`, `StepPage` and `TilesPage` in `hodi:sdk`: « Voir les 4 autres » at the end of a
  list's card, the boxes of a code, « J'ai au moins 13 ans » with every plugin's consent line, a full-page step as the
  setup's, and a choice drawn as « Qui lit ? » draws the profiles.

### Changed

- `whoIsReadingFooter` now sits beside « Gérer les profils » under « Qui lit ? »'s tiles: draw a `Button`, at the
  same height, rather than a line of text.
- `avatarMenu` entries sit under a line, after the profiles, in a quieter tone, their icon at 16 px in a plain round:
  they read as actions, not as one more profile.

### Fixed

- The test kit (`@hodi-app/plugin-sdk/testing`) works in a plugin's own repository: `sharp` is now a dependency of the
  SDK instead of being half bundled into it.

## [0.5.0] - 2026-11-09

Everything a plugin such as Village needs: pages before sign-in, accounts and households, e-mail, notifications,
scheduled work, its own feeds, the household's AI behind a click, the hooks to forget people and copy their data,
`npx hodi-plugin dev` to try it in Hodi while writing it, and a test kit. Plugins built for 0.4.0 keep working: API 2
does not change, but accounts, households, sign-ins, e-mail and notifications now need a signed plugin.

### Added

- The admin reads what a plugin will be allowed to do before installing it: write every permission it needs in
  `plugin.json`.
- `setupSteps` in `definePlugin()`: a plugin found before Hodi's setup adds its own steps to the wizard, ending with
  `SetupActions`; `{ core: 'mail' }` places Hodi's e-mail step among them.
- `publicRoutes`, with `permissions.publicRoutes`: routes open to anyone at `/api/public/plugins/<id>/`, where `who` is
  `null`, the body is JSON up to 64 KB and one address gets 30 requests a minute.
- `ctx.mail`, with `permissions.mail`: `available()` and `send({ to, subject, text })` through Serveur › E-mail, with
  Hodi's footer, 50 e-mails an hour per plugin.
- `ctx.accounts`, with `permissions.accounts`: `get`, `findByEmail`, `create({ email, password })` and
  `checkPassword(email, password)`, which counts with the failed sign-ins of the address the request came from.
- `signIn` in a public route's answer, with `permissions.signIn`: signs the device in with an account this same call
  made or checked, never the server's admin.
- `checkSignIn({ accountId, householdId }, ctx)`, with `permissions.signIn`: refuses a sign-in with a key of the
  plugin's locales; a check that fails or runs out of time refuses too, the server's admin is never asked.
- `ctx.households`, with `permissions.households`: `list`, `get`, `of(accountId)`, `create({ name, language, admin })`,
  and `suspend`, `resume`, `remove` for the households the plugin made.
- `moveDevice` in a route's answer, with `permissions.households`: « Changer de foyer » to a household the signed-in
  account has a profile in.
- `ctx.serverSettings()` on the server and `useServerSettings()` on the web: what Serveur › Contenu and Sauvegardes
  promise (`articleDays`, `videoDays`, `textDays`, `backupCopies`), read only, for every plugin.
- Places around sign-in in `definePlugin()`: `signedOutPage`, `signInExtras`, `afterSignIn`, `whoIsReadingFooter`,
  `ageConsent`, `accountRows` and `avatarMenu`. The places before a profile is open go in `web/public.tsx`, built
  into `web-public.js` and `web-public.css`, the only part a visitor may download; it loads only for a signed plugin
  with `permissions.publicRoutes`. `usePluginPublicApi()` calls the plugin's `publicRoutes`.
- `tasks` in `server.js`: work that runs by itself every so many minutes (from 15 minutes to a week), never early
  after a restart, never twice at once.
- `ctx.http(url, { method, headers, body | json | form })`: any request to a site listed in `permissions.network`
  (an OAuth token exchange), its answer `{ url, status, contentType, text }` whatever its status. A body or an
  `Authorization` header only over https, and such a request never follows a redirect.
- `ctx.accounts` logins, for « Se connecter avec Google »: `create({ email, login })` makes an account with no
  password (`loginOnly`), `findByLogin(login)` finds it again, `addLogin(accountId, login)` links an account the call
  checked. An account found by its login may be signed in like one the call made or checked.
- `signInExtras` is also shown for an account with no password of its own: in « Qui lit ? » in place of its
  password, and in Réglages › Compte et données, where a sign-in less than 5 minutes old stands for the password.
- `hodi-plugin dev --server <address> --code <code>`: builds the plugin at each save and installs it on a Hodi whose
  server admin turned on Serveur › Plugins › Mode développeur, then prints its log. Its pages show although it is
  unsigned, while the mode is on.
- `feeds` in `plugin.json` and in `server.js`: up to 5 feeds of articles on the plugin's own sites, offered in
  « Ajouter une source » in a topic of Hodi's, and read like a site's feed.
- `ctx.notify`, with `permissions.notify`: a notification on a profile's devices, 10 a day per profile, in each
  device's quiet hours and only where its « Plugins » switch is on.
- `ctx.ai`, with `permissions.ai`, for a signed plugin: one question to the household's AI per click on its
  `AiButton` (from `hodi:sdk`), inside the `aiActions` handler the click runs; plain text, within the household's
  daily « Plugins » cap and 10 an hour per plugin.
- `onProfileDeleted`, `onAccountDeleted` and `onHouseholdRemoved` in `server.js`: delete what the plugin kept of
  someone who is gone. Asked again every minute until they answer, even while the plugin is off.
- `exportData` in `server.js`: the plugin's part of « Télécharger une copie », under `plugins.<id>`.
- `@hodi-app/plugin-sdk/testing`: `testPlugin(folder, options)` runs the plugin's server part in Hodi's own sandbox
  and routes, around a small Hodi in memory, for the plugin's own tests.
- `{ proof: true, handler }` for a sensitive route of `routes` or `serverRoutes`: Hodi runs it only once the person
  typed their own password (and the app's code) in `askToConfirm({ proof })`, passed on as `api(path, { proof })`;
  otherwise 403 `proof_required`. The handler never sees them. `testPlugin`'s calls take `proof: true`.

### Changed

- A plugin's database is now in Serveur › Sauvegardes with Hodi's, and « Restaurer » puts both back to the same moment:
  the plugin's data may go back in time. Deletions made since the copy are done again, and the plugin is told again
  (`onProfileDeleted`, `onAccountDeleted`, `onHouseholdRemoved`).
- `settingsPage` is drawn only in Serveur › Plugins, under the plugin's options, for the server's admin: Réglages ›
  Plugins is gone. A plugin with something for every profile it is meant for (its own options, a list) draws it in
  `page`, its own entry of Réglages placed by `menu`. `usePluginLinks().plugins` now leads to the plugin's page in
  Serveur › Plugins; `#/settings/plugins/<id>` opens the plugin's own page.

### Security

- A household's waiting code (`code`) has 8 letters and digits instead of 6 digits.
- `permissions.accounts`, `households`, `signIn`, `mail` and `notify` are for signed plugins only: an unsigned package
  asking for one is refused at install and does not start. `hodi-plugin dev` keeps them, to test them.
- `checkSignIn` waits in a lane of its own, ahead of routes: busy public routes never refuse a sign-in. It waits 3
  seconds at most.
- `ctx.households.create({ admin: { accountId } })` with an existing account needs that account vouched for by the
  same call (`create`, `checkPassword` or `findByLogin`), or throws `not_vouched`.
- `signIn` for an account with « Validation en deux étapes » on no longer signs it in with the plugin's word alone:
  Hodi asks for the app's code in its own dialog (from `usePluginPublicApi()`) before the session starts.

## [0.4.0] - 2026-11-08

The plugin API 2. A plugin written for API 1 is listed as « Désactivé » until it is rebuilt for API 2. Version 0.3.0
was never published: its changes are in this one.

### Added

- The server part runs in its own sandbox (QuickJS in WebAssembly) with its own SQLite database, `memoryMb`, and a
  time limit per call.
- `permissions` in `plugin.json`: `network` (the sites `ctx.fetchText` may reach) and `articles` (`ctx.articles`).
- `serverRoutes` and `serverSections`: a plugin's own sections of the server's space, and `usePluginServerApi()`.
- Raw request bodies (`raw: true`), BLOBs in `ctx.db`, and zip downloads that Hodi builds (`{ zip: { … } }`).
- `who.householdId` and `who.serverAdmin` on every request.
- `Notice` in `hodi:sdk`, with `NoticeTone` and `NoticeAction`.

### Changed

- An unsigned plugin's web part is never served.
- A plugin's API 1 tables are copied once into its own database.

## [0.2.0] - 2026-11-06

### Added

- More of Hodi's components in `hodi:sdk`.
- A plugin's own page in Réglages (`page`, `menu`, `menuIcon`, `menuHint`).
- `readerAction`, at the end of an article.
- `ctx.articles` and `onArticle`.
- `usePluginLinks()`, `usePluginPath()` and `navigate()`, so a plugin never writes Hodi's addresses.

## [0.1.0] - 2026-11-05

### Added

- `hodi-plugin build`, the types of the server part and of `hodi:sdk`, and signing with `--key`.

[unreleased]: https://www.npmjs.com/package/@hodi-app/plugin-sdk?activeTab=versions
[1.0.0-beta.1]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/1.0.0-beta.1
[0.6.1]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/0.6.1
[0.6.0]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/0.6.0
[0.5.3]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/0.5.3
[0.5.2]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/0.5.2
[0.5.1]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/0.5.1
[0.5.0]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/0.5.0
[0.4.0]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/0.4.0
[0.2.0]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/0.2.0
[0.1.0]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/0.1.0
