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
  role, last sign-in and devices, and makes a code for a new password when its person forgot theirs. A household made
  for someone else shows _waiting for_ that person until they use their code, and **New code** replaces a lost one.
- **Delete**, at the end of both pages, asks for the server admin's password and app code. An account goes with its
  profile, and its household's admin role passes to the oldest other adult with an account. A household goes with its
  profiles and the accounts that read nowhere else. The server admin's own account goes from _Account and data_.
- **Content**: how long the server keeps what it fetches, for every household. An article stays in the lists 1 to 14
  days (3 by default), a video 7 to 180 days (60), and the text of a read article 1 to 30 days (7). It also caps the
  sources a household may follow.
- **Backups**: the nightly copies of the database and of the plugins' data, 1 to 30 kept (7 by default). It makes a copy
  at once, and downloads or restores one with the account's password, since a copy holds everyone's data.
- **E-mail**: the mail server Hodi sends through, with a test to the admin's address. Until it is set, Hodi sends no
  e-mail at all. Once saved, the server's password is never shown again, not even to the admin.
- **Plugins**: the server's admin adds, turns on and off, sets and removes them. _Available_ lists the plugins of
  [Hodi's registry](https://github.com/leclaudeur/hodi-plugin-registry), to install or update from there, and
  **Install from a file** takes any other. A plugin can add its own group of sections to this sidebar, such as
  Village's _Sign-ups_, and one made for every profile gets an entry in _Settings_.

Restoring a copy first keeps a copy of how things are now, then restarts Hodi with the copy in place. The plugins' data
goes back to the same moment, and what was deleted since the copy, such as an account or a household, is deleted again.

Once _E-mail_ is set with Hodi's address, the sign-in page shows **Forgot password**. It always answers the same,
whether an account has that e-mail or not. The account gets a link valid for one hour, once, which signs out its other
devices and opens its profile.

That address also lets a plugin open its public pages to search engines, such as Village's welcome page and legal
pages. Every other page of Hodi stays out of them.

[← Back to the features](../features.md)
