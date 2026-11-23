# The Server space

The account that set Hodi up runs the server. _Settings › Server_, shown to that account only, opens a space of its own,
apart from the app. It has its own sidebar on a computer and its own levels on a phone, and the house button goes back
to the app.

> [!NOTE]
> The server sees accounts and numbers, never what anyone reads nor their settings. Only a household's admin hands over
> that role, in _Settings › Profiles_: the server's admin never picks it.

- **Overview**: a dashboard of every household and profile together, only totals. Its figures and day by day chart
  cover visits, articles read, hours of reading, videos and shares, beside the period before. Cards add who has Hodi
  open right now (kept in memory only), the profiles, the most read topics and sources, and the server's health: feeds,
  last backup, e-mail, plugins and version. The period is 7, 30 or 90 days, a year, all, or any two dates from
  **Choose dates**. A plugin can add its own cards after Hodi's.
- **Households** and **Accounts**: each list has its own search. A household's page says who runs it and how many
  profiles it has, invites an adult with a code and lists its accounts. An account's page gives its e-mail, household,
  role, last sign-in and devices, and makes a code for a new password once its person asked for one. A household made
  for someone else shows _waiting for_ that person until they use their code, and **New code** replaces a lost one.
- **Delete**, at the end of both pages, asks for the server admin's password and app code. An account goes with its
  profile, and its household's admin role passes to the oldest other adult with an account. A household goes with its
  profiles and the accounts that read nowhere else. The server admin's own account goes from _My account_.
- **General**: the server's addresses. **Hodi's address** is the one the e-mails' links open; it starts as the
  address the page is open at, and the e-mailed codes of _Forgot password_ need it. The **public home page** is a site's address, such as
  Hodi's presentation page. A browser that never signed in on this server, opening its bare address, goes there instead
  of _Sign in_. Once it has signed in, or with an address of the app's own (`#/sign-in`, a code's or a reset code's button),
  _Sign in_ opens as usual. Empty by default.
- **Content**: how long the server keeps what it fetches, for every household. An article stays in the lists 1 to 14
  days (3 by default), a video 7 to 180 days (60), and the text of a read article 1 to 30 days (7). It also caps the
  sources a household may follow.
- **Backups**: the nightly copies of the database and of the plugins' data, 1 to 30 kept (7 by default). It makes a copy
  at once, and downloads or restores one with the account's password, since a copy holds everyone's data.
- **E-mail**: the mail server Hodi sends through, one row at a time: the server with its port and security, its user
  name and password, and the sender. Until the server and the sender are both there, Hodi sends no e-mail at all. Once
  saved, the server's password is never shown again, not even to the admin. A test goes to the admin's address.
- **To do**: the requests the server asks its admins to act on, in their language, one row each, filtered by kind
  (sources, reports, password codes, plugins); the count of those waiting shows beside _To do_ in the sidebar. A row opens
  where its request is done: a password code on the account that asked it, with its orange notice; a plugin's on the
  plugin's page; a source to review in _To do_ itself, accepted or refused (asked first) with its topics and whether
  it suits teens and children; a reported source in _To do_ too, with how many reported it and why (never who), then
  _Ignore_ or _Take out of the catalogue_ (asked first: those who read it keep it). Once done, a request leaves _All_ for _Handled_, the last filter, for 7 days, then goes.
  A notice that asks nothing, such as the weekly report, only goes out by e-mail or push.
- **Alerts**: for each kind of notification, Hodi's and the plugins', whether it also goes out by e-mail or push, or
  not at all.
- **Plugins**: the server's admin adds, turns on and off, sets and removes them. _Available_ lists the plugins of
  [Hodi's registry](https://github.com/leclaudeur/hodi-plugin-registry), to install or update from there, and
  **Install from a file** takes any other. A plugin can add its own group of sections to this sidebar, and one
  made for every profile gets an entry in _Settings_.

Restoring a copy first keeps a copy of how things are now, then restarts Hodi with the copy in place. The plugins' data
goes back to the same moment, and what was deleted since the copy, such as an account or a household, is deleted again.

_Forgot password_ on the sign-in page always answers the same, whether an account has that e-mail or not. Once _E-mail_
is set and _General_ has Hodi's address, the account gets an 8-character code valid for one hour, once, with a button
that fills it in. On a server that sends no e-mail, the page asks the server's admin instead: the request lands in
_Notifications_, the account's page shows _Code asked_, and **Make a code** there gives the code to hand over. Without a request, or after a week, the account's page makes no
code: the person asks again. Either
way, the person types it, chooses a new password, which signs out the account's other devices, and enters Hodi. **I
have a code** on that page goes straight to the code, for someone coming back with it later. Wrong codes count against
the device, as wrong passwords do.

[← Back to the features](../features.md)
