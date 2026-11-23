# Sign-in and sessions

Each person has their own account, and every `/api/*` route needs a session, except sign-in, sign-out and the setup
screens. The household's settings, its profiles and its AI key also need the admin profile.

## Passwords

A password is 8 characters at least, and the database keeps only a salted scrypt hash of it (`N=32768, r=8, p=3`, one of
the settings OWASP recommends). At most two checks run at once. A hash made with weaker settings is made again at the
next sign-in, without signing any device out. A wrong address gets the same answer, after the same work, as a wrong
password.

## Session cookies

A sign-in sets a signed, stateless cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, valid 90 days. Browsers accept a
`Secure` cookie on HTTPS and on `localhost` only, which is why phones need HTTPS.

The cookie is signed with a key derived from the session secret, the account's password hash and its session
generation. A new password therefore signs out that account's other devices, and no one else's.

One device may hold up to 5 accounts of the same household, for _Who's in?_: the cookie then carries one token per
account, joined by `~`, and each is checked on its own. A profile opens only for an account whose token is there, and
an account of another household is refused at sign-in.

Signing out removes only the token of the account whose profile is open, and that device's row in the account's
devices. [Deployment](../deployment.md#sign-out-every-device) shows how to sign
out every device at once. The web bundle holds no data and is public, so the sign-in page can load.

## One-time codes

The codes behind **I have a code** are eight random characters out of 31: capitals and digits without 0, O, 1, I or L,
typed in any case, with or without spaces or dashes. A code works once, within 24 hours, and the database keeps only an
HMAC of it, keyed with the session secret. A wrong code counts against the same throttle as a wrong password.

- **Who makes one**: an adult profile only, and only the admin for a profile that already exists.
- **A young profile's code** is any parent's to make, and links one device to that profile.
- **A new password**: only the server's admin makes this code for an adult, in _Server › Accounts_. It only sets a new
  password, and signs out that account's devices.

A young profile's device holds a signed `y1` cookie that names its row in `profile_devices`. The row goes after 90
days unused, when a parent removes it, or with the profile. That device never changes profile, makes no code and sees
no list of devices.

## Profiles in _Who's in?_

What an adult profile asks for before it opens depends on two settings, both off on a new install:

- A **private profile** asks for its account's password, which the server checks against that account's hash. The
  parental code never opens it.
- Any other adult profile asks for the household's **parental code** when the admin has set one: six digits, kept as a
  hash like a password and never sent back. Setting, changing or turning it off asks for the admin's own password (and
  the authenticator app's code when it is on).
- Without either, it opens at once. Teen and child profiles always do.

Each device may fail an account's password, or the household's code, 5 times in 15 minutes, so a child guessing on a
tablet never blocks the parents' own devices. All devices together stop after 50 failures.

**Don't ask again on this device**, under a private profile's password, marks that account's own session row on the
device as trusted. The private profile opens there without the password only while that session still exists and is
still marked trusted. **Ask again**, signing the device out from the list, a new password or signing out on that device
all end it. A tablet shared by a parent and a teen therefore opens the parent's private profile only if the parent chose
so.

The device's choice of an adult profile is signed with a version that changes with the account's password, with
**Private profile** being turned on and, for a profile the parental code opens, with that code. After any of them, every
other device asks again before the profile opens. Only that signed choice says which account signed in on the device is
asking: a profile id written in the cookie by hand reads as nobody's.

## Actions that ask again

The actions that can't be undone ask for the person's own password again, whatever session the device holds. A device
left open, or a stolen cookie, therefore can't do any of them:

- deleting one's account, or another adult's profile that has an account;
- handing over the household's admin role;
- installing or removing a plugin, or starting the developer mode;
- downloading or restoring a backup;
- a code for a new password, or deleting an account or a household, in the _Server_ space.

The password is the one of the profile open on the device, and a wrong one counts against the throttle. An account
without a password of its own, made by a plugin's sign-in, shows a sign-in on that device in the last 5 minutes instead.

## Two-step verification

_Two-step verification_ (TOTP, RFC 6238) is required for the server's account and optional for every other adult, in
_My account › Sign-in_. Codes have 6 digits and 30-second steps, with one step of drift either way.

With it on, a sign-in asks for the app's code after the right password, and so does every action above. Each code
works once: the last step used is kept, and an older or equal one is refused. A wrong code counts against the
throttle, like a wrong password.

- **Turning it on** asks for the password, then the app's first code, within 15 minutes.
- **The secret** is sealed with AES-256-GCM, under a key derived from the session secret.
- **10 recovery codes** are shown once and kept as HMACs; each replaces the app's code once.
- **The server's account** can't turn it off, and the _Server_ space asks for it until it is on.

_Who's in?_ never asks for the app's code, as the device is already signed in. A new password, by code or by e-mail,
never signs such an account in on that device: it signs in again with the app's code.

## Blocked e-mails

_Block_ in _Server › Accounts_ keeps an e-mail from making an account again. Only its SHA-256 is stored: that keeps
the address itself off the server, but it is no secret, as anyone holding a backup can check a guessed address. At
_Sign in_, a blocked address is told so and counts as a failed sign-in, so addresses can't be tried at full speed.
Aliases of the same mailbox (dots or `+tag` with Gmail) are other addresses and are not blocked. The server admin can
unblock an address they type, after their password.

## Throttling

Each client may fail 10 sign-ins, or setup codes, within 15 minutes. Further attempts are refused with `429` until its
oldest failure leaves the window. All clients together may fail 100 times in that window, which caps a guessing
attempt spread over many addresses.

A client is known by its connection's address. Behind a reverse proxy on the same machine or network, it is the last
`X-Forwarded-For` entry or `X-Real-IP`, the one the proxy added. Bots trying passwords from the internet therefore
never block the household's own sign-ins, and devices already signed in keep working in every case.

[← Back to security](../security.md)
