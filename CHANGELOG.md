# Changelog

All notable changes to Hodi are documented in this file: what changes for people who install and use it.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each pull request adds its line under « Unreleased »; a
release moves them under its number and date. The plugin SDK has its own: [plugin-sdk/CHANGELOG.md](plugin-sdk/CHANGELOG.md).

## [Unreleased]

### Added

- **Report a source.** A flag on every source card, in My sources and the catalogue, tells the server's admin why a
  source does not belong (illegal, hateful, misleading, something else). The admin sees how many reported it and why,
  never who, in Server › To do, and ignores it or takes it out of the catalogue. A new kind in Server › Alerts.
- **Report a share.** Under a share received, Report tells the server's admin why it should not have come
  (harassment, hateful, spam, something else), once per share and at most 5 a day; Stop receiving their shares mutes
  its sender at once. The admin sees the share and its sender, never shown who reported it, in Server › To do, and ignores it
  or blocks the account. A new kind in Server › Alerts.
- **Block a site.** For illegal content, Server › To do › a source › Block this site blocks its whole domain: every
  source on it is erased with everything read of it, leaves every list, and can't be added again; the account that
  added it is blocked too, without the admin learning which. Server › Blocks lists the blocked domains, to unblock one,
  and unblocks an e-mail address.
- **Block an account.** Server › Accounts › an account › Block deletes it, as Delete does, and its e-mail can never
  make an account on the server again. The person is told so at sign-in.
- **Username.** Every account has an @username, unique on the server, for friends and mentions to come. It is suggested
  from the first name when the account is made (first-run screens, an invitation's code), says at once whether it is
  free, and changes once every 30 days in My account. Existing accounts get one from their profile's name. Sign in
  with the e-mail or the username.
- **Teens' and children's accounts.** A parent creates them in My account › My children: teen or child, first name,
  @username and the password the parent chooses. The young one signs in with that username and password; the parent
  changes the password from their card. Existing teen and child profiles become accounts linked to the household's
  adults, with no password until a parent chooses one.
- **AI without caps.** Each account pays with its own key, so no daily cap stops its purple buttons any more: My
  account › AI shows its calls of the last 24 hours, with nothing to reset. Only a runaway guard stays: past 30 AI
  calls in a minute, a person's next ones wait for the minute to pass. A plugin keeps its own hourly limit.
- **Sources as cards.** Settings › Sources shows two grids of cards, the base sources then the account's own, the
  first card adding one. The catalogue shows the same cards by topic, in the topics' colours, searched and sorted
  apart (alphabetical or by readers, either way); a source already in My sources stays in place, ticked. The
  Official tab is gone: everything in the catalogue is approved.
- **Sources to review.** With Server › Content › Review sources on, a source someone adds from a link stays out of
  everyone else's catalogue until a server admin accepts it in Server › To do, with its topics and whether it suits
  teens and children. Its adder keeps reading it meanwhile. Server › Notifications becomes To do: the requests
  waiting, filtered by kind, each opening where it is done (a password code on the account that asked it); a
  request done moves to Handled for 7 days. The weekly report only goes out by e-mail or push.
- **Board review.** Source cards end on a footer line, Retirer a red round on the left and each other action its
  own round on the right, with the readers count in the corner and a red or grey mark on the logo for a feed that
  fails or a source little read. My sources come before the base sources, catalogue topics are in alphabetical
  order, and Cyber and Manga/Anime get their colours. Every button that asks a confirmation first is red. Add a
  source keeps only the AI's suggestions (the catalogue has the rest), and the guided tour adds its first source
  from the catalogue. Offline reading has its own section in My account.
- **Your own time format, game and language.** The time format, Levels and badges and the language are each
  person's, in My account › Profile (a teen's in Settings › General); the language follows the browser until
  someone picks one. Server › General no longer sets them for everyone. A young one's card lives in My account ›
  My children (Settings › Teens and children is gone), and Invite someone sits at the foot of Server › Accounts.
- **My children, after review.** A parent's requests and children are two lists, a request answered in its row
  (Accept, Refuse); the parents' list shows names and since when; a teen's devices signed in with its username are
  on its card for its parents to sign out; Link a device is gone. Statistics no longer show the household challenge.
- **A second parent.** On a teen's or a child's card, Parents invites another adult by their @username; they answer
  in My account › My children, and both parents then have the same rights. A parent can stop being one, never the
  last one, and neither can take the other off. Deleting your account takes the young ones you are the only parent of
  with it, and its confirmation says so.

### Changed

- **One group of people on the server.** A server with several households merges them once: every profile, code and
  plugin's AI turned off joins the first one. Invited people lists the invitations each adult made, and a plugin's AI
  turned off is off for the whole server. A code made by the server's admin sets a new password for anyone but
  themselves.
- **One catalogue of sources for the server.** Every source added is in the one catalogue of the server, and each
  person still picks the ones they read in My sources. A server with several groups of people merges their lists once,
  each feed keeping the topics it had first; a source only one group saw waits in Server › To do. A source someone
  added stays for the others who read it when that person removes it or leaves: it becomes the server admin's.
- **Each device shows its accounts' profiles.** Who's reading? and every profile list show the profiles of the
  accounts signed in on the device and their teens' and children's, no longer every profile on the server. Send to…
  still finds anyone by their @username. An adult's profile goes only with its account (My account, or Server ›
  Accounts); the admin's password is no longer asked to delete one from Profiles.
- **One file for the fixed settings.** Every limit, duration, rate and size that Server does not let the admin
  change is now in `config.yml`, with a comment for each: change a value and restart Hodi (the web app's values need a
  new build). A missing or wrong value stops Hodi at start, saying which.
- **My sources.** Each person's sources are now their own list, kept with their account: a source someone adds goes
  into their list only, and the others add it from the server's sources when they want it. A new adult starts with the
  base sources. A source read by 10 people or more shows how many. Each person keeps the sources they read before.
- **Catalogue.** A page of its own, from My sources › Browse the catalogue: the official sources, then each theme in its
  sidebar, in your language first, with a search. Each card shows the site's logo, name, what it says it is (read
  when the source is added), its readers and its site; + puts it in My sources, − takes it out. My sources has no
  switches anymore: a source is in the list or taken out of it.
- **Only a young one's parents manage them.** Their card, rules, devices and deletion are their parents' only: the
  server's admin no longer has a say over other people's children. The Parental code moves to My account › My
  children, and teens and children no longer have AI settings of their own.
- **A Parental code for each adult.** Each adult chooses their own in My account › My children, advised to parents.
  It is asked to open that adult's profile only on a device where a teen or a child is signed in, or once was, never
  on the adult's own devices; a forgotten code is replaced by the adult's password. The household's single code goes,
  and becomes the code of each of its adults. A teen can now add their account to Who's reading? on a shared device
  with their username.
- **Sharing by @username.** _Send to…_ offers the family, the accounts signed in on the device and whoever you
  shared with lately; any other adult on the server is found by typing their @username. A teen or a child shares only
  with their parents, brothers and sisters, and nobody outside the family can send them anything.

- **Stats and points belong to the account.** An adult's readings, stats, points and badges are their account's,
  not their profile's: they stay the same in any household, after leaving one or being removed from it, and My
  account shows them while the person is in no household. A young profile, which has no account, keeps its own.
  Deleting the account deletes them.
- **Your settings, saved articles and history belong to the account.** An adult's preferences (sources and topics
  turned off, followed and hidden topics, reading settings), Saved, History, what Hide put away and the stories seen
  in Top news are their account's: they come back as they were after leaving a household and joining another. A
  young profile keeps its own; deleting the account deletes them.
- **Your name, colour and photo belong to the account.** They come back with the profile you get on joining a
  household again, and joining with _I already have an account_ no longer asks who you are when the account has been in
  a household before.
- **Your time zone belongs to the account.** _Settings › My account_ gets a _Region_ card where each person picks
  their own; it moves out of _Settings › Household_. Their screen time, quiet hours, game points and Daily summary follow its days.
  Every account starts with its household's.
- **My account is a page of its own.** Laid out as the legal pages, with its sections in a sidebar (a _Sections_ menu
  on a tablet or a phone): _Profile_, _Sign-in_, _Region_, _Statistics_ and _Data_. _Settings › My account_ and
  _Settings › Statistics_ open it, and Settings lines that open another page end with an external-link icon.
- **Each account has its own AI key.** _My account › AI and credits_ holds the key, the country used by the AI's web
  searches and the account's own calls of the day, against its own caps: 100 summaries, 100 questions, 8 Daily summaries,
  10 source suggestions and 20 plugin requests. Each account keeps the summaries it paid for. The key of the first-run
  screens is the admin's; every account that read in the household starts with the household's key. A young profile
  has no AI.
- **No household in the app any more: a server and its accounts.** _Settings › Household_ and _Leave the household_
  are gone. The default language, the time format and the game move to _Server › General_, with the server's data.
  _Settings › Profiles_ becomes _Teens and children_, with the parental code, and _AI and credits_ moves under _You_.
  The server's admin invites someone from _Server › Accounts_ with _Invite someone_, which replaces _Invite an adult_
  and _Server › Households_, and keeps what the household's admin could do. The first-run screens no longer ask for a
  household name.
- **A new password only when asked.** _Server › Accounts_ makes a new-password code for an account only while its
  person waits for one after _Forgot password_: _Make a code_ is in their request, and the account page has no button
  otherwise; a request waits a week. The server's admin can no longer make one for an account that did not ask.

### Removed

- **Plugins no longer make households.** `ctx.households` and the plugin permission _Create and manage households_ are
  gone: a plugin makes accounts instead. A plugin that still makes households stops working on this version, so
  update your plugins together with Hodi.
- **Household photos.** Nothing showed them any more: the server deletes the ones it still kept.
- **Later at the end of the setup.** The setup always ends with the server admin's own profile. A server whose setup
  went on without one counts as set up, and its admin's profile is made at their next sign-in.
- **The household admin role.** What it allowed (other adults' profiles, the game switch, stored texts, other people's
  sources, the plugins' AI use and the plugins for the admin only) is now the server admin's alone, and Pass the admin
  role is gone. On a household where the admin was another adult than the server's admin, that adult loses them.
- **No household left to show, and no limit of 5 profiles.** Every account has its own profile: one without (made by
  a plugin, or whose profile was deleted) gets it at its next sign-in, with the name and colour it had, or the start of
  its e-mail. The screen « You have no household any more » is gone, and invitations and new profiles no longer stop at 5.
- **Devices linked to a young profile by a code.** A teen or a child now signs in with the account a parent made in
  My account › My children. A device still linked by a code is signed out: sign it in with that account.

## [1.0.0-beta.13] - 2026-11-19

One household per account, Who's in? keeps the accounts of the device, private profiles and a parental code, My
account, invited people, forgot password with a code, and the server's notifications inbox. Plugins need
`@hodi-app/plugin-sdk` 1.0.0-beta.5 for what is new here.

### Added

- **Server > Notifications.** A new inbox lists what the server told its admins, in their language. A request someone
  waits on stays on top, in orange, under To handle, until it is handled; its count shows beside Notifications in the
  menu. How each kind reaches the admins moves to Server > Alerts.
- **Plugin requests under To handle.** A plugin can mark what it tells the server's admin as a request someone waits
  on, such as a waitlist sign-up: it stays under To handle in Server > Notifications until the plugin closes it.
- **Forgot password with a code.** Forgot password now e-mails an 8-character code (valid an hour, once) instead of a
  link: the person types it on the page, or opens the e-mail's button, then chooses a new password and lands on a
  done screen. I have a code goes straight to the code, for someone coming back with it later. Wrong codes count
  against the device, as sign-in attempts do.
- **Forgot password without e-mail.** On a server that sends no e-mail, Forgot password asks the server's admin for a
  code: the admin is told (Server > Notifications, and by e-mail or push as chosen), the account shows Code asked, and
  Make a code there hands the person their 8-character code to type on the same page.
- **Invited people.** Settings > Profiles shows its profiles under Adults, Teens and Children, then the invitations
  nobody used yet under Invited people. Invite an adult asks a name to recognise the invitation by and, once
  Server > E-mail is set, an address to send the code to. Each invitation can be sent again (or its code shown again)
  and cancelled.
- **Leave a household.** Settings > My account shows your household and your role, with Leave: your profile and what
  you read there go, your account stays and can join another household with a code. The last adult with an account
  cannot leave.
- **An account with no household.** After leaving, or once its profile is deleted, an account signs in to a card that
  says so, with My account on a page of its own (e-mail, password, devices, a copy, deleting it) and Sign out.
  `#/account` opens My account in every case.
- **A plugin's way on with no household.** The card of an account in no household can show a plugin's button, such
  as Village's Create my household.

### Changed

- **One household per account.** An account belongs to one household only. Joining another household with an
  existing account says which household it is in, and asks to leave it first. On a server with Village, Which
  household? and Switch household are gone.
- **Who's in? keeps the accounts of the device.** Who's in? shows the accounts signed in on this device and the
  household's young profiles, like a TV's streaming app. Add signs one more account in with its e-mail and password; an
  account of another household is refused, a device serving one household. Sign out takes only the account whose
  profile is open: the others stay, and the last adult out takes the young profiles with them, back to sign-in. New
  profiles are made in Settings > Profiles only.
- **Opening a profile.** In _Who's in?_, an adult profile opens at once again, unless one of two new settings says
  otherwise. _Private profile_, in Settings > My account, asks for the account's password on every device, except the
  ones where _Don't ask again on this device_ was ticked (_Ask again_ takes them back). _Parental code_, in Settings >
  Household, asks for six digits for every adult profile that is not private; the admin sets, changes or turns it off
  with their own password (and the app's code). Accounts from before keep asking for their password: their profile is
  private until they turn it off.
- **My account.** Settings > Account and data becomes My account, and starts with your profile (name, photo, colour)
  and your language, which leaves Reading and display. My profile becomes General: the guided tour and the reset.
  Clearing your reading stats moves under the stats. A teen or a child keeps its name, photo, language and time of the
  day in General.
- **Two-step verification is a switch.** In Settings > My account it turns on and off like any other setting, and once
  on, a row of its own shows the recovery codes left, with New codes. The server's account keeps it on.
- **A long list of devices folds.** Settings > My account shows three devices and See the N others; unfolded, the list
  scrolls in a box of its own.
- **New passwords come from the server's admin.** Settings > Profiles no longer gives another adult a new password,
  not even for the household's admin. The code for a forgotten password comes from the server's admin only, in
  Server > Accounts.
- **Language on the signed-out screens.** Sign-in, I have a code, Forgot password and the setup show the language as a
  round button with the other language's code, as on the public site; sign-in has it too now. With three buttons in a
  step's footer, Back keeps only its arrow at every size.
- **Names stand out.** In dialogs and at the top of the Settings, Server and My account pages, the names of households
  and profiles and the e-mail addresses are in bold, and the names of screens and buttons in italics.

### Fixed

- **Top news.** A story has the same layout on a phone, a tablet and a computer: its picture in a frame, then its
  topic, title, summary and buttons. On a phone the picture is no longer stretched over the whole screen, where a news
  site's small picture showed as big pixels.
- **Sharper pictures.** When a feed gives a small picture (under 960 pixels) and the article's page has a larger one,
  Hodi makes its copies from the page's. Pictures already made are made again once, in the background.
- **Read on the site.** In the reader, the round button of the "can't be read in Hodi" notice is white again in the
  dark theme (dark in the light theme), with its icon readable.
- **Info lines and checkboxes.** The icon of an info or error line sits on the middle of its text, and the
  _I am at least 13 years old_ box lines up with the icon of the field above it.

## [1.0.0-beta.12] - 2026-11-17

Every household sees its sources' icons again.

### Fixed

- **Source avatars.** Every household sees its sources' icons, and a source added since the server started shows its
  own too. Until now only the sources of the server's first household had one, and each other avatar was refused.

## [1.0.0-beta.11] - 2026-11-17

Nobody gets banned by a server's proxy any more for using Hodi, and two small fixes on Who’s in? and Followed.

### Changed

- **Who’s in?** The buttons under the profiles are all as wide as the widest, and one under the other on a phone.

### Fixed

- **Followed.** Add a subject, when no subject is followed yet, opens Settings › Followed instead of Settings.
- **Nobody banned by the server's proxy.** Using Hodi never makes a burst of refused requests any more, which a proxy
  such as CrowdSec bans as probing. It happened when the app opened in a new tab on a profile that asks for its
  password, to the server's admin outside any household, to a teen outside its hours, and on a list of cards whose
  pictures Hodi had not made smaller or a page of sources without an icon.

## [1.0.0-beta.10] - 2026-11-17

Signing in with Google from a new browser works again when the server has a public home page.

### Fixed

- **Google sign-in.** Signing in with Google from a browser that never signed in here no longer lands on the public
  site (Server › General › Public home page): Google's return to the app's address now opens Connexion and finishes
  the sign-in.

## [1.0.0-beta.9] - 2026-11-16

A hidden topic leaves the feed too, and the reader's back button returns to the list in one step on a phone.

### Fixed

- **Feed.** A topic turned off in Settings › Topics leaves the feed too, not only the menu. An article that also
  belongs to a topic still shown stays, under that one.
- **Teens' topics.** A topic a parent turns off and on again comes back in the teen's lists too.
- **Back button.** On a phone or a tablet, the reader's back button returns to the list in one step, even after
  several articles opened one after the other (as a computer does, before its window narrows).

## [1.0.0-beta.8] - 2026-11-16

The push checks in Server › Notifications wait until this device takes push notices.

### Fixed

- **Server › Notifications.** The push checks stay greyed out and empty until "Push on this device" is on and the
  browser allows notifications, as the e-mail ones do without Server › E-mail.

## [1.0.0-beta.7] - 2026-11-16

The server's admin chooses how to hear of each event and gets a weekly report, every e-mail comes in one dark
template, and the installed app always opens on Connexion.

### Added

- **Server › Notifications.** The server's admin chooses, for each kind of event, e-mail, push, both or neither, and
  turns push on for each device. Plugins add their own kinds under their name.
- **Weekly report.** On Monday from 08:00, the server's admin gets the past week's numbers beside the week
  before (visits, articles, videos, reading time, shares, new profiles), with a table from each plugin that has one.
  Chosen like any other kind in Server › Notifications.

### Changed

- **E-mails.** Every e-mail Hodi and its plugins send uses one dark template, made to show well in every mail app,
  with a plain-text copy for the ones that show no HTML. The password reset has a button. Under the card, every e-mail
  says "Sent by Hodi" and gives the public site's address (Server › General), else Hodi's: never a plugin's name.

### Fixed

- **Installed app.** Hodi added to a home screen or as a desktop app always opens on Connexion, never on the public
  site set in Server › General.

## [1.0.0-beta.6] - 2026-11-15

Plugins can read the public site's address, code fields lose their repeated label, and empty settings pages stop
scrolling.

### Added

- **Plugins.** A plugin can read the public site's address from the server's general settings.

### Changed

- **Code fields.** The two-step sign-in and "I have a code" no longer repeat "Code" above the boxes: the screen's
  title already says it.

### Fixed

- **Empty settings page.** A page of the server's space or of a plugin with nothing to list no longer scrolls: its
  empty state takes the room left under the title.

## [1.0.0-beta.5] - 2026-11-15

The e-mail test works for a server's admin outside any household, and a failed e-mail leaves its cause in the log.

### Changed

- **E-mail.** When a test or a message cannot be sent, the server's log gives the mail server's exact error.

### Fixed

- **Shown password.** It reads at the size of the other fields' text, no longer larger and spaced out.
- **E-mail test.** A server's admin with no profile in a household can use "Send a test" to reach their own address; it
  failed as "the server doesn't answer".

## [1.0.0-beta.4] - 2026-11-15

Code fields read in two groups with a dash, and the setup code says where to find it in one short notice.

### Changed

- **Setup code.** Where to find it is now a blue notice under its boxes, as wide as them, instead of a « ? ».
- **Code boxes** read in two groups with a dash between, and fill their place: each box keeps a 44 × 60 shape, its
  corners and its text in proportion, up to 44 px wide. The setup code in the log reads the same way, `ABCD-1234`; it
  is typed with or without the dash.
- **Commands in a sentence** show in the mono font with no tile behind them.
- **Page not found.** The big « 404. » now carries the accent dot, and the title under it has none.

## [1.0.0-beta.3] - 2026-11-15

Hodi starts on any processor, even a virtual machine with a generic CPU, and its image is 9 MB lighter.

### Fixed

- **Virtual machines with a generic CPU.** Hodi now starts on a processor without SSE4, such as Proxmox's kvm64: its
  pictures then show from their site, without a smaller copy, and a profile photo cannot be added there.

### Removed

- **sharp's WebAssembly build**, added in 1.0.0-beta.2: it needs SSE4.1, so it did not help the processors that lack
  x86-64-v2, and it weighed 9 MB in the image.

## [1.0.0-beta.2] - 2026-11-15

Hodi now installs on more servers: older processors and Portainer without admin rights.

### Fixed

- **Older processors.** Hodi now starts on a processor without x86-64-v2, such as a virtual machine with a generic
  CPU: its pictures then go through a slower WebAssembly build instead of stopping the server at start.
- **Portainer without admin rights.** `compose.image.yml` no longer sets `cap_drop` and `security_opt`, which
  Portainer refuses to a user who is not its admin: the stack deploys as it is.

## [1.0.0-beta.1] - 2026-11-15

The first beta of Hodi 1.0: accounts for everyone, the Serveur space, plugins and their SDK, Hodi's plugin list, and
a ready-made image for servers without a shell. The plugin API is frozen until 1.0.

### Added

- **Install without a shell.** Each version is published as the image `ghcr.io/leclaudeur/hodi`, for Intel or AMD and
  ARM processors, and `compose.image.yml` runs it on a server managed only through a web UI such as Portainer.
- **« BETA » beside the logo.** A pre-release version (such as 1.0.0-beta.1) shows a small « BETA » beside the
  logo everywhere in the app. It goes away by itself with the first plain version.
- **Public home page.** In Serveur › Général, a site's address: a browser that never signed in, opening Hodi's bare
  address, goes to that site instead of Connexion. Once it signed in, Connexion opens as before. Hodi's own address,
  which the e-mails' links open, moves there from Serveur › E-mail, and every page of the Serveur space gets a fuller
  introduction.
- **Support Hodi.** A « Soutenir Hodi » link to Hodi's Patreon in Réglages › À propos and at the end of the Serveur
  space's menu. Hodi stays free, with no ads and nothing to pay.
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

- **A lighter first visit.** Someone who is not signed in no longer makes the ten requests a signed-in reader's
  screens need (each one refused): Connexion, or a plugin's page, appears a little sooner.
- **Le fil has no « ? » any more,** on a computer or a phone: the guided tour already explains it.
- **Connexion shows at once.** No plugin draws a page in its place any more, so it no longer waits for the plugins. A
  public welcome page and its signup form now live on their own static site (get-hodi.com for Hodi's public server).
- **Messages under a field.** An error or a password hint starts where the field's icon does, and on a phone the
  line about a field stays under it instead of going under its button.
- **Serveur › E-mail, one row at a time.** The server, its user name and the sender each have their own row and
  « Changer », as in Réglages, instead of one big form. Hodi sends once the server and the sender are both given.
- **A refused field shows it.** Its border, background and text turn red, like the boxes of a wrong code, on
  Connexion, in the settings and in every dialog.
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

- **Frandroid's articles instead of its newsletter form.** The reader showed the newsletter sign-up and its data
  notice in place of a short article, or nothing at all: the sign-up is left out and the text column is read.
- **A list in a box stays in the text.** Gamekult's games of the week, in a box after the last paragraph, were
  left out of the reader and the article stopped on « place aux sorties de la semaine : ».
- **Elle's galleries read in full.** A gallery article showed only its introduction: the reader now keeps its
  slides' text, without the « 5 Voir la galerie » buttons.
- **Fewer feeds failing on a timeout.** Every feed was fetched at once, and a quick one could wait out its 5
  seconds behind the others (Voici, Femme Actuelle, Sonovision): they are now fetched 10 at a time, and a feed or an
  article page gets 10 seconds.
- Serveur › Plugins lists a plugin whose version is a pre-release, such as 1.0.0-beta.1, and offers 1.0.0 to a server
  that has 1.0.0-beta.1, or beta.2 to one that has beta.1.
- **Serveur › Vue d'ensemble with a keyboard.** The small curves of its figures no longer take a stop of their own
  while hidden from screen readers.
- **Grey text easier to read in the Clair theme.** The secondary grey is a shade darker (#786a5d), so captions and
  hints on the columns' background pass the 4.5:1 contrast that WCAG asks for.
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

[unreleased]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.13...HEAD
[1.0.0-beta.13]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.12...v1.0.0-beta.13
[1.0.0-beta.12]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.11...v1.0.0-beta.12
[1.0.0-beta.11]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.10...v1.0.0-beta.11
[1.0.0-beta.10]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.9...v1.0.0-beta.10
[1.0.0-beta.9]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.8...v1.0.0-beta.9
[1.0.0-beta.8]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.7...v1.0.0-beta.8
[1.0.0-beta.7]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.6...v1.0.0-beta.7
[1.0.0-beta.6]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.5...v1.0.0-beta.6
[1.0.0-beta.5]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.4...v1.0.0-beta.5
[1.0.0-beta.4]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.3...v1.0.0-beta.4
[1.0.0-beta.3]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.2...v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/leclaudeur/hodi/compare/v1.0.0-beta.1...v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/leclaudeur/hodi/releases/tag/v1.0.0-beta.1
