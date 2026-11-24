# Accounts and families

One install is one server. Everyone on it has **their own account**: an e-mail or a username, a password and one
profile that only they open. There is no household around anyone and no limit to the number of accounts.

## Username

Every account has an @username, unique on the server: lower-case letters, digits, a dot or an underscore, 3 to 20 of
them. The form that makes an account (the first-run screens, an invitation's code) suggests one from the first name and
says at once whether it is free, or else offers a free one like it. _My account › Profile_ changes it once every 30
days; the one left stays the account's for 30 days, so nobody else takes it at once. The sign-in screen takes the
e-mail or the username.

## Setting up

The setup starts with the account of the server's admin, protected by two-step verification right away. Plugins put in
`data/plugins/` before the first start come next, under _Plugins found_, each on by default; one turned off stays
installed for later, in _Server › Plugins_. The setup always ends with the admin's own profile, its name and colour.

## Joining with a code

Codes are eight letters and digits with a QR, valid once for 24 hours, typed after **I have a code** on the sign-in
page. An invitation's code always makes a **new account**: someone who already has one signs in with it instead.

- **Someone new**: the server's admin makes the code with **Invite someone**, in _Server › Accounts_. Once
  _Server › E-mail_ is set, an address sends the code by e-mail; without one, the dialog shows it. The new person then
  chooses an e-mail and a password, ticks **I am at least 13 years old** and makes their profile.
- **A forgotten password**: once its person asked for it from _Forgot password_, the server's admin makes this code in
  _Server › Accounts_. Its person types it, then a new password. With _Server › E-mail_ set, an e-mail link does it.

An e-mail that already has an account, or is blocked, is refused, and counts as a failed sign-in: one code never tries
addresses in a loop. Until it is used, an invitation waits under _Invited people_, where **Send again** or **See the
code** gives it a new code for another 24 hours (only a hash of a code is kept), and the red cross cancels it.

## Families

A parent makes their teens' and children's accounts in _My account › My children_. Each signs in with its username and
the password the parent chose, on any device, and opens its own profile only. **Invite a second parent** asks another
account of the server, by its username, to share that role; two parents at most, and **Step back** gives it up.

The parents run their young ones in _Settings › Teens and children_: their sources, their hours and their time a day. A
teen asks for a source; its parents accept or refuse it in _Requests_, and never see another family's. A family also
shares a weekly challenge in the game.

## The server's admin

The account that set Hodi up is the server's admin. It runs the server in its own space (see
[The Server space](server-space.md)): the accounts, the catalogue of sources, the plugins and every setting that
counts for everyone. **Make server admin**, in _Server › Accounts_, gives the same role to another adult.

The last server admin can't delete their account while other adults remain: they make one of them server admin first.
Deleting another adult's account, or making them server admin, asks for the admin's own password first. Nobody gives
another adult a new password without being asked.

## Opening a profile

Hodi starts on _Who's in?_ each time it opens, as a TV app does, but not on a reload nor while another Hodi tab is open
in the same browser. It shows the accounts signed in on the device, then their teens' and children's profiles. What an
adult profile asks for there depends on two settings, both off for a new account:

- **Private profile**, in _My account › Sign-in_: an adult turns it on with their password. Their profile then asks for
  that password on every device. **Don't ask again on this device** (unticked) lets it open at once on that device.
  The **Trusted devices** row lists how many do, and **Ask again** takes them all back. Signing out of a device,
  signing it out from the list or a new password take it back too.
- **Parental code**, in _My account › My children_: a parent sets six digits. On a device where one of their young
  ones is signed in, their own profile then asks for them, unless it is private. A forgotten code is never shown again:
  the parent types a new one.
- Without either, an adult profile opens at once. Teen and child profiles never ask for anything.

**Add** signs one more account in with its e-mail or username and its password, and the app's code when two-step
verification is on. **Sign out** takes only the account whose profile is open: the others stay. When the last adult
signs out, the young profiles leave with them and the device goes back to the sign-in page. To change profile, use the
selector at the foot of the sidebar on a computer, or _Who's in?_ from the header's avatar on a tablet or a phone.

Each profile has its own settings, saved articles, history, followed subjects and statistics, on the server: every
device that opens the profile shares them, a phone as well as a computer.

## Two-step verification

In _My account › Sign-in_, an adult adds a code from an authenticator app to their password. Turning the switch on
asks for the password, shows a QR and the key to type, and takes the app's first code. It then shows 10 recovery codes
once, to download or copy, and a _Recovery codes_ row tells how many are left.

Signing in on a new device then asks for the app's code after the password, or a recovery code, and so does every moment
that asks for the password again. _Who's in?_ never asks for it. New recovery codes and turning the switch off ask
for the password and a code.

> [!IMPORTANT]
> Two-step verification is required for a server admin. The setup turns it on right after their account, and the
> Server space asks for it at its next opening when it is off.

## Time zone

Each account has its own time zone, in _My account › Region_. A young reader's hours and screen time, the points of
the game and the _Daily summary_ follow the days of that time zone. An account starts with the one chosen in the
first-run screens, which the server's own figures in _Server › Overview_ keep.

## Deleting an account

_My account › Data_ downloads a copy of everything Hodi keeps about the account, or deletes it, in red, with the
password. The profile goes with what it read, saved and followed; its children's accounts go too when it is their only
parent. A source it added that others read becomes the server admin's.

## About

_Settings › About_ shows the version, a link to the source code (AGPL-3.0) and the credits of its images, icons and fonts.

[← Back to the features](../features.md)
