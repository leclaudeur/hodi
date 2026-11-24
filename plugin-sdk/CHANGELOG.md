# Changelog

All notable changes to `@hodi-app/plugin-sdk` are documented in this file: what changes for people who write a Hodi
plugin.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Feature pull requests add their line under « Unreleased »
and never touch `version`; a small release pull request raises `version` and moves the lines under it, then the tag
`sdk-v<version>` publishes it.

## [Unreleased]

### Added

- **`ctx.accounts.list`, `suspend`, `resume` and `remove`.** A plugin with `permissions.accounts` lists the accounts it
  made (`ctx.accounts.create`), newest first, and suspends, resumes or removes one of them; any other account is
  refused with `not_allowed`, the server's admin always. A suspended account is signed out of every device and
  refused at each sign-in with the plugin's `signIn.suspended` text, until resumed. `remove()` deletes it as
  Serveur › Comptes does, and every plugin's `onAccountDeleted` hears of it. Each `PluginAccount` now also has `mine`
  and `suspended`, and for the plugin's own accounts `name` and `createdAt` (null for anyone else's). The admin of each
  household a plugin made becomes that plugin's account, suspended if the household was; its other members, who came
  in by Hodi's invitations, stay their own.

- **`ctx.accounts.create({ name })`.** The person's first name, as _Mon compte_ shows it: a sign-up form no longer
  needs a household to keep it.

### Deprecated

- **`ctx.households`.** Households are leaving Hodi: one account is one person's space. Use `ctx.accounts` instead;
  `who.householdId` goes in a later beta.

### Changed

- **Hodi's limits built in.** The SDK carries the limits of the Hodi it was built with (Hodi's `config.yml`): the test
  kit and `hodi-plugin build` follow that SDK version's values, and a plugin's folder needs no config file.
- **`ctx.articles` runs for a reader.** It answers within a route of the app, an `aiActions` handler, `exportData` and
  `onArticle`; a task, a feed, another hook, a public route or the server's space gets `no_reader` (was
  `no_household`).
- **`ctx.notify`.** `accountId` reaches the profile that account reads with. Within a person's own route or an
  `aiActions` click, it reaches only that person and the people they have a tie with (family, or a share either way);
  anyone else answers `unknown_profile`. A task, a hook, a public route or Serveur reaches anyone. Three an hour per
  plugin and profile at most, besides the ten a day.
- **`ctx.ai`'s hourly cap** of 10 questions counts per plugin and profile.

### Removed

- **`ctx.households` and `permissions.households`.** Hodi no longer has households a plugin makes or runs: a plugin makes
  accounts (`ctx.accounts.create`) and suspends, resumes or removes them. A manifest that still asks for `households`
  loads, and the permission is ignored.
- **`HouseholdAvatar`** is gone from `hodi:sdk`, with the household photo it showed (`/api/households/<id>/photo`).
- **`who.householdAdmin`.** Hodi no longer has a household admin: what that role allowed is the server's admin's, so
  check `who.serverAdmin` instead.
- **`noHousehold` routes and the `noHouseholdActions` slot.** Every account now has its own profile, given at its first
  sign-in, so no account is ever left in no household: a route marked `noHousehold: true` is an ordinary route, and
  `noHouseholdActions` draws nowhere. In the test kit, `noHouseholdRoute` is gone; `addAccount` makes an account with
  no profile yet.
- **`useServerHouseholds()`**, with Serveur › Foyers, and `householdId` in `useServerAccounts()`: every account reads
  on the server as one, with no household around it.
- **`who.householdId`** in routes, `aiActions`, `checkSignIn` and `exportData`, and `householdId` in
  `onProfileDeleted`: one account is one person's space, so `who.accountId` and `who.profileId` say whose data it is.
- **`onHouseholdRemoved`.** When the last adult deletes their account and the whole server is erased, each profile's
  `onProfileDeleted` and each account's `onAccountDeleted` are called instead.
- **The test kit's `householdId`, `householdRemoved()` and `household` option.** `testPlugin(folder, { language })`
  sets the server's language.

## [1.0.0-beta.5] - 2026-11-19

Plugins can show Hodi's − / + number picker and its multi-select of a source's topics, offer a way on to an account
left with no household, and keep a server notice waiting until it is handled. An account now belongs to one household
only. Needs Hodi 1.0.0-beta.13 or later.

### Added

- **`Stepper` in `hodi:sdk`.** The number picked with − and + of Server › Content, faster when clicked quickly or
  held. With `editable`, the value in the middle can also be typed: a number within `min` and `max` counts at once,
  one outside them is brought back inside when the field is left.
- **`ChoiceField` in `hodi:sdk`.** The multi-select of a source's topics: picked choices become tags, typing filters
  the list, and the list opens above the dialog so its edge never cuts it. `choices` are `{ id, label, icon? }`, with
  `selected`, `onChange` and an optional `max`.
- **Bold and italics in intros.** The intro of `Dialog`, `SectionPage` and `askToConfirm` shows `<b>…</b>` (a name, an
  e-mail) in bold and `<i>…</i>` (a screen's or a button's name) in italics, as Hodi's own texts do.
- **A green notice.** `Notice` takes `tone="success"`, for what just worked.
- **A server notice that waits.** `ctx.notifyServerAdmin(type, { …, important: 'waitlist:12' })` marks a request
  someone waits on: it stays under _To handle_ in Server › Notifications, and the same key still waiting is not
  sent again, until `ctx.serverNoticeHandled('waitlist:12')`. Keys are the plugin's own (letters, digits, `. _ : -`,
  100 at most). In the testing kit, such a notice in `serverNotices` has `waiting`, true until it is handled.
- **A way on for an account in no household.** `noHouseholdActions` in `definePlugin()` draws under the text of the
  card an account lands on once it left its household (or its profile was deleted), such as _Create my household_. Only
  the plugin's public part is loaded there. A route marked `noHousehold: true` (`{ noHousehold: true, handler }`)
  answers that account, with `who.accountId` set and `who.profileId` and `who.householdId` null; every other route
  answers it 423 `no_household`. Only a route of `routes` can be marked. Once the plugin made the household, it calls
  `done()` and Hodi starts again on it. In the test kit, `noHouseholdRoute(route, accountId)` calls a route as such an
  account (one `addAccount()` made).

### Removed

- **One household per account.** An account now belongs to one household only, so the ways to move between
  households are gone: the `afterSignIn` step (_Which household?_), the `whoIsReadingFooter` buttons under _Who’s in?_,
  and the `moveDevice` answer of a route (now ignored). `ctx.households.of()` lists at most one household, and
  `ctx.households.create()` refuses (`invalid_household`) an `admin.accountId` that is already in a household.

## [1.0.0-beta.4] - 2026-11-16

Plugins can tell the server's admin of an event, add a table to the weekly report, and send e-mails in Hodi's template.

### Added

- **Server notices.** `serverNotifications` in `plugin.json` lists the events a plugin can tell the server's admin
  of, each a row of Serveur › Notifications (`manifest.serverNotifications.<type>` in its locales for other
  languages), and `ctx.notifyServerAdmin(type, { title, text, path })` tells of one, by e-mail or push as the admin
  chose. It needs `permissions.notify`. The test kit records them in `serverNotices`.
- **Weekly report.** A `weeklyReport({ from, to }, ctx)` hook adds the plugin's table, one to eight rows of `label`,
  `value` and an optional `change` (`{ text, good }`), to the server admin's weekly report under its name. The test kit calls it with `weeklyReport(week)`.
- **Texts per language.** A notice's `title` and `text`, and a report row's `label`, `value` and `change.text`, may be
  one text or one per language (`{ fr, en }`, type `PluginWritten`): each admin reads theirs, the French when it is
  missing.
- **E-mails.** `ctx.mail.send` takes, besides `text`, an optional `title`, `eyebrow`, `code` with its `caption`, one
  `action` (`{ label, url }`) and a `note`. Hodi builds the e-mail in its dark template, with a plain-text copy. Text
  may put a name in italics with `<i>…</i>`; any other markup stays text. `language` (`'fr'` or `'en'`) sets the
  language of the words Hodi adds, for someone who has no account yet.

### Changed

- **E-mails.** An e-mail with only `to`, `subject` and `text` now comes in the template too, with the subject as its
  title. Nothing in it names the plugin any more: it ends with « Envoyé par Hodi » and the public site's address.

## [1.0.0-beta.3] - 2026-11-15

Plugins can read the public site's address.

### Added

- **Public site.** `ctx.serverSettings()` gives `publicHome`, the public site's address from the server's general settings,
  or `null`. `testPlugin` takes it as its `publicHome` option.

## [1.0.0-beta.2] - 2026-11-15

The same API as 1.0.0-beta.1, with the right links on npm.

### Changed

- The package's homepage on npm is the SDK's site, https://sdk.get-hodi.com, and its README links to it.
- Keywords and the address for issues on npm.

## [1.0.0-beta.1] - 2026-11-15

The API of Hodi 1.0, frozen until 1.0.0. It removes `publicPages` and `signedOutPage`; a plugin that used neither keeps
working as with 0.6.1. It comes out with Hodi 1.0.0-beta.1, under npm's `beta` tag:
`npm install @hodi-app/plugin-sdk@beta`.

### Removed

- `publicPages` in `plugin.json` and `signedOutPage` in `definePlugin()`, with `SignedOutPageProps`: no plugin draws
  the signed-out screens any more, and Connexion shows at once, without waiting for the plugins. A public site (a
  welcome page, legal pages, a signup form) is its own static site, which calls the plugin's `publicRoutes` through a
  proxy on the same address. `signInExtras`, `afterSignIn`, `whoIsReadingFooter` and `ageConsent` stay.

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

What a plugin still needed once 0.5.0 was out, and a test kit that works in a plugin's own repository. Nothing changes
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

Everything a plugin that opens Hodi to the public needs: pages before sign-in, accounts and households, e-mail, notifications,
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
[1.0.0-beta.5]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/1.0.0-beta.5
[1.0.0-beta.4]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/1.0.0-beta.4
[1.0.0-beta.3]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/1.0.0-beta.3
[1.0.0-beta.2]: https://www.npmjs.com/package/@hodi-app/plugin-sdk/v/1.0.0-beta.2
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
