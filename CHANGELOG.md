# Changelog

All notable changes to Hodi are documented in this file: what changes for people who install and use it.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each pull request adds its line under « Unreleased »; a
release moves them under its number and date. The plugin SDK has its own: [plugin-sdk/CHANGELOG.md](plugin-sdk/CHANGELOG.md).

## [Unreleased]

## [1.0.0-beta.1] - 2026-11-14

The first beta of Hodi 1.0: accounts for everyone, the Serveur space, plugins and their SDK, Hodi's plugin list, and
a ready-made image for servers without a shell. The plugin API is frozen until 1.0.

### Added

- **Install without a shell.** Each version is published as the image `ghcr.io/leclaudeur/hodi`, for Intel or AMD and
  ARM processors, and `compose.image.yml` runs it on a server managed only through a web UI such as Portainer.
- **Support Hodi.** A « Soutenir Hodi » link to Hodi's Patreon in Réglages › À propos and at the end of the Serveur
  space's menu. Hodi stays free, with no ads and nothing to pay.
- **Public pages for search engines.** A plugin that draws the signed-out screens can open some addresses to search
  engines (its home page, its legal pages, one per language). Hodi sends their title, description and share card, and
  serves `robots.txt` and `sitemap.xml`, once Serveur › E-mail has Hodi's address. Every other address, and every
  install without such a plugin, stays out of search engines as before.
- **Plugins from Hodi's list.** Serveur › Plugins shows the plugins of Hodi's registry under « Disponibles »:
  « Installer » downloads one, checks it against the registry's sha256, then asks the same questions as a file. A
  newer version shows on the plugin's row and page, with « Mettre à jour ». « Installer depuis un fichier » still works.
- **Serveur › Vue d'ensemble keeps its numbers.** Each night the server keeps one row of the whole server's totals
  for the day (visits, reads, videos, time, shares, new profiles, accounts), for good; the first year is filled from
  the readings already kept. The page's data can now cover 90 days, a year, everything, or any two dates, and lists
  every theme and source instead of the first five.
- **Serveur › Vue d'ensemble is a dashboard.** Five figures with their line and their change against the period
  before (click one to draw it large, the period before dashed behind it), who is online by device, the profiles,
  every theme and source read, and the server's health (feeds, last backup, e-mail, plugins, version), over 7 days,
  30 days, 90 days, a year or everything, on the whole width of a computer.
- **Any two dates in Serveur › Vue d'ensemble.** The calendar button beside the periods opens two months (one on a
  phone) to pick the first and last day; the dates then stand in for the periods, with a cross back to 7 days.
- **Plugins in English.** A plugin's name and description show in the language of the interface when the plugin
  gives them, in Serveur › Plugins, Réglages and the setup.
- **A photo for the household.** Its admin adds one in Réglages › Foyer, as a profile's; it shows in Serveur ›
  Foyers. Serveur › Comptes shows each account's profile photo too.
- **Sources par foyer.** Serveur › Contenu sets how many sources a household may follow, all its profiles together:
  no limit by default, or 10 to 1,000. It replaces the `MAX_SOURCES` environment variable (200 by default), which
  Hodi no longer reads.
- **Backups hold the plugins' data.** Each copy in Serveur › Sauvegardes has every plugin's database of the same
  moment, and downloads as a zip when it does. « Restaurer » puts the core and the plugins back on the same day: a
  plugin removed since stays removed, its data kept 30 days for a reinstall; a plugin installed since starts empty.
- **A restore no longer brings back what was deleted.** Hodi writes down each deleted account, profile and household
  (ids and times only) outside its database, in `forgotten.jsonl`, and does those deletions again on a restored copy,
  plugins included.

- **Personal accounts.** Every adult has an account with an e-mail and a password. The setup starts with the server
  admin's account, then makes a household for oneself or for someone else, or none at all.
- **« Qui lit ? » at every opening of the app**, as on a TV: an adult's profile asks for its own account's password,
  a teen's or a child's opens freely.
- **Serveur › Comptes and Foyers › « Supprimer »**, with the server admin's password: an account with its profile, a
  household with its profiles and the accounts that read nowhere else.
- **« Passer le rôle d'admin »** in an adult's profile form: one admin per household, who can hand the role over.
- **Codes to join a household or to reset a password**, made by an adult (« J'ai un code » on the sign-in page, with a
  QR code that opens the installed app).
- **Réglages › Compte et données**: download a copy of one's data, change one's e-mail and password, delete one's
  account.
- **The server's own space**, `#/server`, for the server admin only, even outside any household:
  - Vue d'ensemble, with the whole server's figures and charts;
  - Foyers and Comptes;
  - Contenu: how long the server keeps what it fetches;
  - E-mail: once set, « Mot de passe oublié » appears on the sign-in page;
  - Sauvegardes: how often, how many copies, download with a password, restore;
  - Plugins, moved from Réglages.
- **Several households on one server**, each with its own sources, AI keys, AI caps and alerts. Every request reads
  and writes its own household only.
- **Plugins**, installed by the server admin from a `.hodi-plugin` file:
  - each runs in its own sandbox (QuickJS and SQLite in WebAssembly), with its own database, a memory and time budget,
    and only the permissions its `plugin.json` declares;
  - a plugin signed by the maintainer says « Vérifié »; any other installs after a second question, and its pages
    are never shown in Hodi;
  - a plugin written for an older plugin API is listed as « Désactivé » until its new version is installed;
  - « Plugins trouvés » in the setup turns on the plugins already in `data/plugins/`, and a plugin may add its own
    steps right after, such as setting the server's e-mail;
  - a plugin may open pages to people who are not signed in (a sign-up, a waiting list) when the admin allowed it at
    the install; Hodi limits each address to 30 requests a minute;
  - a plugin given the permission can send e-mails through Serveur › E-mail (a waiting list’s confirmation), at
    most 50 an hour, each ending with a line that names it.
  - a plugin given the permission can make accounts and check a password; it never sees a stored password, and its
    wrong guesses count with those of « Connexion » for the same address;
  - a plugin's pages, such as its legal pages, can say how long the server keeps what it fetches and how many
    copies it keeps, as set in Serveur › Contenu and Sauvegardes;
  - a plugin given the permission can sign a device in with an account it just made or checked (never the server
    admin's), and refuse a sign-in with its own message (a suspended household); the server admin always gets in;
  - a plugin given the permission can make households (with their admin, or a code for them), and suspend or remove
    only the ones it made; a device can move to another household of its person (« Changer de foyer »);
  - a plugin given the permission can make an account that signs in another way (« Se connecter avec Google »),
    with no password until its person sets one, and only link that way to an account whose password was just typed;
  - such an account opens its profile in « Qui lit ? » through the plugin's button, and changes its e-mail or chooses
    a password in Réglages › Compte et données within 5 minutes of signing in again;
  - a signed plugin may draw on the screens around sign-in: its own page in place of « Connexion » on a device on no
    household, another way in under the form, a step right after sign-in, a line at the foot of « Qui lit ? », the
    terms after « J'ai au moins 13 ans », rows in Réglages › Compte et données and entries in the avatar's menu.
    Before a profile is open, only the public part of the plugins allowed to open pages without sign-in is loaded;
  - a plugin may run scheduled work by itself (every 15 minutes at most), such as clearing what expired;
  - a plugin can send any request to the sites it lists (« Se connecter avec Google »'s token exchange), never
    sending a body or a token in clear nor on to another address;
  - Serveur › Plugins › Mode développeur, off by default: with its code, `npx hodi-plugin dev` installs a plugin
    being written at each save, pages included, until the mode is turned off;
  - a plugin can offer feeds of articles from its own sites in « Ajouter une source »; they open with their summary
    and a link, never in the reader;
  - a plugin given the permission can send a notification to a person's devices, at most 10 a day per profile, in
    their quiet hours, and each device can turn them off in Réglages › Notifications › Plugins;
  - a signed plugin given the permission can ask the household's AI one question per click on its violet button,
    within a daily « Plugins » cap; Réglages › IA et crédits shows each plugin's calls and can turn its AI off;
  - a plugin's sensitive action (deleting data, changing an account) asks for the person's own password, and the app's
    code with « Validation en deux étapes », in Hodi's own dialog; Hodi checks them and the plugin never sees them;
  - a plugin's sign-in (« Se connecter avec Google ») of an account with « Validation en deux étapes » asks for the
    app's code in Hodi's own dialog before the device is signed in;
- A single notice for information, warnings and errors, used across Réglages and the server's space.
- Historique in the list of Réglages, on a phone and on a computer.
- Soft colour glows behind the empty reader on a computer; the first card shows its swipe once on touch screens.

### Changed

- **Hodi opens faster on a phone.** The server's space, the setup and the settings now download apart, so the app's
  first download is about a third smaller (353 KB down to 239 KB).
- **Articles read faster.** Reading an article page takes about 20 % less time: the page is read twice instead of
  four times, and the byline clean-up skips long blocks.
- **Faster start over plain HTTP.** The code every start needs comes in one file instead of about 26, so a
  Hodi opened without HTTPS shows its first screen sooner on a phone.
- **The QR code maker downloads only when a code is shown**, 8 KB less for every first load.
- **Search, À la une and Le fil answer faster** with many sources: the grouping of articles by story reads each
  title and date once instead of on every comparison.
- **The server keeps answering while it reads articles.** Their text is extracted on a thread of its own, so a
  heavy page no longer holds up every request for up to a second.
- **Rows have the same padding on every side.** Réglages' rows, accordions, notices and lists on a phone had more
  room on their sides than above and below; it is now the same all around, and a notice's square lines up with the
  rows beside it.
- **A warmer welcome.** The setup opens as the landing page does: its big title, one sentence and « Installer Hodi »,
  over soft moving colours that stay behind every step after it, Connexion and « J'ai un code » too. On a phone,
  each step is now on its card, centred like on a computer, and the page scrolls when the screen is too short.
- **A new password's strength is a ring** in the lock's place, filling a quarter per level, red to green. Under the
  field, one line says what to add while it is weak, and goes once it is strong: the setup, « J'ai un code », a reset
  and « Changer le mot de passe ».
- **Codes of « J'ai un code » have 8 letters and digits** instead of 6 digits, typed in any case, in two groups of
  four, without the characters that read alike (0, O, 1, I, L). A code made before the update no longer works: make
  a new one.
- **The setup code** (asked away from the server's network, written in its log) has the same 8 letters and digits.
- Every settings row has one layout: its value or a short description under its title, its button at the end (a
  round one on a phone), its text no wider than 500 px, and its actions 38 px tall.
- At most six accent colours.
- Check boxes are squares with rounded corners (the age box, « Partager à »), so they never read as radio buttons.
- Sources take their site's name, with its icon on a light tile.
- Add buttons sit under their list (Profils, Plugins, Sources).
- No daily cap on game points.
- The French interface no longer says « ton/ta/tes ».
- Stronger password hashing; changing a password signs out every other device.

### Removed

- Four-digit profile codes, the parental code and the household's shared password: each adult has their own account.
- « Passe à ton propre compte », which moved a household from its shared password to personal accounts.
- Réglages › Plugins: plugins are added and set in Serveur › Plugins. A plugin with something for every profile has
  its own entry in Réglages.

### Fixed

- Serveur › Plugins lists a plugin whose version is a pre-release, such as 1.0.0-beta.1, and offers 1.0.0 to a server
  that has 1.0.0-beta.1, or beta.2 to one that has beta.1.
- **The app no longer piles up its old versions on each device.** After an update, the offline copy keeps only the
  files of the new version.
- **Serveur › Foyers for a household made for someone else.** Until that person uses the code, the list and the
  household's page say « en attente de Sophie », and « Refaire son code » gives a new code when the first one is lost
  or past its 24 h. A blue card at the top of Foyers says why there is no « Créer » on a server that has its
  household (one household per server), « Aucun foyer » and a search with no match sit in the middle of the page as the app's
  empty lists, the two « Créer » buttons are as wide as each other, and the search no longer shows before the list.
- **The setup's polish.** The key of « Protège le compte » wraps inside its tile with a copy icon, the code field is
  ready to type in on a computer, and the step titles sit in the middle of their band.
- **À la une on a fresh install.** A topic whose articles were still being checked had no circle until the next
  visit: the row now asks again every few seconds while the server checks.
- **The reader's line meets the list's.** On a computer, the line under an open article's bar sat 2 px above the one
  under the list and the sidebar.
- **Fewer site leftovers in the reader.** An « A lire aussi » without its accent and its card (Vogue, Futura), a
  box with the date, the author and « Partager » (Le Grand Continent) and a « Topics » list of tags (TechCrunch) no
  longer show in the text.
- **No more subscriber teasers in the reader.** An article whose site keeps it for its subscribers, and serves only
  its first lines (Elle, Sonovision), is hidden like any other paywalled article instead of opening cut short.
- **La Libre and DH articles read in full.** Their pages show the start of a free article and leave the rest to
  their script: the reader now reads the whole text from the page's data, and articles that were hidden as too short
  open. A subscriber's article is still never read.
- **Jeuxvideo.com and OpenAI back in the lists.** Their sites turn Hodi's reader away (403), so their articles were
  all hidden. They now show their summary and a link to the site, like 7sur7, on installs that already follow them
  too.
- **No more blank screen while the app loads.** When the server takes more than 300 ms (opening the app, opening a
  profile, just after signing in), the Hodi logo rises in the middle of the page, its dot breathing, instead of an
  empty, dark page. A plugin whose files do not come within 5 seconds is skipped, so the app never waits for it.
- **An unverified plugin's options have their names.** Serveur › Plugins showed them by their raw key
  (« autoSignals »): Hodi now serves such a plugin's texts, never its code.
- **Opening Hodi again no longer shows a feed that fails to load.** The app read the session asked for as the page
  loaded, from before the profile closed for « Qui lit ? »: it now goes straight to « Qui lit ? ». A second tab or
  the installed app opened beside an open tab keeps that tab's profile instead of closing it under its feet, and a
  profile closed elsewhere brings « Qui lit ? » back at once.
- **A household a plugin made works while the first household is left for later.** After « Aller à l'espace Serveur »
  at the setup, its people got « unauthenticated » after signing in: they now read in their household.
- The day just loaded comes up to the top in Le fil and Suivis.
- No drop-down is cut by a dialog or a scrolling list, and nothing behind an open dialog scrolls.
- A shared article that was read stays in Partages.
- Hours always show their leading zero (01:00).
- Toasts show in front of dialogs.
- A dialog opened over another one (« Nouveau mot de passe ? » over « Modifier le profil ») no longer stops taking
  typing and clicks when something arrives behind it.

### Security

- **Node.js 24.22.3.** The Docker image is built on the Node.js release of 11 November 2026, which fixes
  several vulnerabilities, some reachable from the Internet or through a reverse proxy speaking HTTP/2. Rebuild the
  image (`docker compose up -d --build`) to get it.
- **A limit per address.** Past 3,000 requests in a minute, one address gets « too many requests » until the
  minute ends: a flood stops there, far above what a household's devices send. The machine Hodi runs on is never
  counted.
- A profile photo must really be a WebP, JPEG or PNG picture, not just say so.
- An article's saved picture is read only for a well-formed article id, a YouTube source is recognised by its exact
  host, and a search word is escaped whole: three CodeQL findings.
- The CI and release workflows run each GitHub Action at a fixed commit.
- **« Validation en deux étapes »** with an authenticator app (Google Authenticator, 1Password, Aegis…): required for the
  server admin, set in the setup screens or at the next opening of `/server`; optional for every other adult, in
  Réglages › Compte et données. It asks for the app's code at sign-in on a new device and at the moments below, never
  in « Qui lit ? ». 10 recovery codes, shown once, replace the phone.
- **Your password at the moments that cannot be undone**: deleting your account, deleting another adult's profile
  with its account, a « Nouveau mot de passe » code for another adult, handing over the admin role, installing or
  removing a plugin, the developer mode, and a backup's download or restore. A device left open is not enough any
  more.
- Deleting a profile, an account or a household also deletes what the plugins kept of it, and « Télécharger une
  copie » includes what each plugin keeps of you.
- A plugin removed with its data kept loses that data after 30 days, and hears of the people deleted meanwhile if it
  is installed again before.
- « Télécharger une copie »: one at a time, and 5 a minute, for each account.
- A plugin can never reach Hodi's database, files or network outside what its permissions allow, nor run anything in
  Hodi's page unless it is signed.
- Every request is limited to its own household.
- A plugin that is not « Vérifié » cannot ask for accounts, households, sign-ins, e-mails or notifications: it is
  refused at install, and one already installed does not start. Mode développeur still allows them, for testing.
- People signing in are answered first, even while a plugin's public pages are busy.
- A plugin can make a household for an existing account only after that person typed their password.
- A device signed out from Appareils, a deleted account, a removed young device or a deleted profile can no longer
  come back through its old cookie when a new one takes the same number in the database.
- A household's admin can no longer make a code that resets the server admin's password, nor the password of someone
  who also reads in another household.
- Hodi refuses a change sent by another website (`Sec-Fetch-Site`), including one on a sibling subdomain.
- Wrong passwords from an IPv6 connection count for its whole /64.

## [0.1.0-alpha] - 2026-11-03

The first public version: RSS feeds by theme, a reader view, videos, up to five profiles, optional AI features, one
Docker container, and a setup in the browser.

[unreleased]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.1...HEAD
[1.0.0-beta.1]: https://github.com/leclaudeur/hodi/compare/v0.1.0-alpha...v1.0.0-beta.1
[0.1.0-alpha]: https://github.com/leclaudeur/hodi/commits/v0.1.0-alpha
