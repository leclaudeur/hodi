# The household

One install is one household, set up in the browser on the first visit (see [Deployment](../deployment.md#2-first-run)).
It has up to **5 profiles** and no password of its own: everyone signs in with their own account, an e-mail and a
password.

## Setting up

The setup starts with the account of the server's admin. Plugins put in `data/plugins/` before the first start come
next, under _Plugins found_, each on by default; one turned off stays installed for later, in _Server › Plugins_.

_The server is ready_ then offers two ways on. **Create my household** goes through the household's steps, while
**Server space** leaves the household for later. A server admin with no profile in a household signs in to the Server
space alone.

With no household yet, _Server › Households_ offers **Create my household**, and **Create a household** for someone
else. The second one asks for the household's name and its admin's first name: that profile waits for its person, who
joins with a code, and **New code** makes another if it is lost or past its 24 hours. Once the server has its household,
neither button shows: one install is one household. The server's admin never enters a household they did not create
for themselves.

## Joining with a code

Codes are eight letters and digits with a QR, valid once for 24 hours, typed after **I have a code** on the sign-in page.

- **A new adult**: another adult makes the code with **Invite an adult**, in _Settings › Profiles_, under a name that
  tells the invitation apart. Once _Server › E-mail_ is set, an address sends the code by e-mail; without one, the
  dialog shows it. The new person then chooses an e-mail and a password, ticks **I am at least 13 years old** and makes
  their profile.
- **An adult profile with no account yet**: the admin gives it to its person with **Connect a device**, in its form.
- **A teen's or child's own device**: a parent makes the code in _Settings › Profiles › Manage › Devices_. That device
  opens this profile only, with no _Who's in?_, until it goes unused for 90 days or a parent removes it.
- **A forgotten password**: only the server's admin makes this code, in _Server › Accounts_, never a household's admin.
  Its person types it, then a new password.

Until it is used, the invitation waits under _Invited people_, below the profiles' groups (_Adults_, _Teens_,
_Children_). **Send again** or **See the code** replaces its code with a new one for another 24 hours, as only a hash of
a code is kept, and the red cross cancels it.

On a code's page, **I already have an account** links the profile to an existing account instead of a new one, as long
as that account reads in no other household: one account belongs to one household.

## The admin

The household's first profile is its admin. It creates and deletes the other profiles,
and runs the household's sources, its AI key and its settings in _Settings › Household_, photo included.

The admin hands the role to another adult with an account with **Hand over the admin role**, in that adult's form, and
becomes a member. That and deleting an adult profile that has an account both ask for the admin's own password first.
No one in the household can give another adult a new password.

## Leaving the household

An account belongs to one household. _My account › Data_ shows it with your role, and **Leave**, in red, asks for
your password: your profile goes with what you read, saved and followed there, and your account stays. When you are
the admin, the dialog names the adult who takes the role over. The last adult with an account cannot leave, as no one
could open the household any more: deleting the account is then the only way out.

An account with no household, after leaving or once its profile was deleted, signs in to a card that says so, with
**Sign out** and _My account_ on a page of its own (`#/account`: e-mail, password, two-step verification, devices, a
copy, deleting the account). A new code from another household's adult, with **I already have an account**, makes it
join again. `#/account` opens the same page for an account in a household, and _Settings › My account_ links to it.

## Leaving the household

An account belongs to one household. _My account › Data_ shows it with your role, and **Leave**, in red, asks for
your password: your profile goes with what you read, saved and followed there, and your account stays. When you are
the admin, the dialog names the adult who takes the role over. The last adult with an account cannot leave, as no one
could open the household any more: deleting the account is then the only way out.

An account with no household, after leaving or once its profile was deleted, signs in to a card that says so, with
**Sign out** and _My account_ on a page of its own (`#/account`: e-mail, password, two-step verification, devices, a
copy, deleting the account). A new code from another household's adult, with **I already have an account**, makes it
join again. `#/account` opens the same page for an account in a household, and _Settings › My account_ links to it.

## Opening a profile

Hodi starts on _Who's in?_ each time it opens, as a TV app does, but not on a reload nor while another Hodi tab is open
in the same browser. What a profile asks for there depends on two settings, both off on a new install:

- **Private profile**, in _Settings › Account and data_: any adult turns it on, with their password. Their profile then
  asks for that password on every device. Under the password, **Don’t ask again on this device** (unticked) lets it
  open at once on that device. The **Trusted devices** row lists how many do, and **Ask again** takes them all back.
  Signing out of a device, signing it out from the list or a new password take it back too.
- **Parental code**, in _Settings › Household_: the admin sets six digits. Every adult profile that is not private then
  asks for them, and opens at the last digit. Setting, changing or turning it off asks for the admin's own password
  (and the authenticator app's code when it is on). A forgotten code is never shown again: the admin types a new one.
- Without either, an adult profile opens at once. Teen and child profiles never ask for anything: their parents open
  them for them.

_Who's in?_ shows the accounts signed in on the device, then the household's teen and child profiles, as a TV's
streaming app does. **Add** signs one more account in with its e-mail and password, and the app's code when two-step
verification is on; an account of another household is refused, as a device serves one household. Signing in opens
your own profile at once. An adult profile whose account is not signed in on the device does not show there, and one
whose person has no account yet stays closed until they make one, with a code. New profiles are made in
_Settings › Profiles_ only.

**Sign out** takes only the account whose profile is open: the others stay, and _Who's in?_ opens again. When the last
adult signs out, the young profiles leave with them and the device goes back to the sign-in page. To change profile, use the
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
> Two-step verification is required for the server's account. The setup turns it on right after that account, and the
> Server space asks for it at its next opening when it is off.

## Time zone

Each account has its own time zone, in _My account › Region_. A young reader's hours and screen time, the
points of the game and the _Daily summary_ follow the days of that time zone. An account starts with the household's, chosen in the
first-run screens, and the server's own figures in _Server › Overview_ keep that one.

## About

_Settings › About_ shows the version, a link to the source code (AGPL-3.0) and the credits of its images, icons and fonts.

[← Back to the features](../features.md)
