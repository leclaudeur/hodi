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

Signing out clears the cookie on that device. [Deployment](../deployment.md#sign-out-every-device) shows how to sign
out every device at once. The web bundle holds no data and is public, so the sign-in page can load.

## One-time codes

The codes behind **I have a code** are eight random characters out of 31: capitals and digits without 0, O, 1, I or L,
typed in any case, with or without spaces or dashes. A code works once, within 24 hours, and the database keeps only an
HMAC of it, keyed with the session secret. A wrong code counts against the same throttle as a wrong password.

- **Who makes one**: an adult profile only, and only the admin for a profile that already exists.
- **A young profile's code** is any parent's to make, and links one device to that profile.
- **A new password**: the admin's code for another adult only sets a new password, and signs out their devices.

A young profile's device holds a signed `y1` cookie that names its row in `profile_devices`. The row goes after 90
days unused, when a parent removes it, or with the profile. That device never changes profile, makes no code and sees
no list of devices.

## Profiles in _Who's in?_

An adult profile asks for its account's password each time it opens, and the server checks it against that account's
hash. Each device may fail an account's password 5 times in 15 minutes, so a child guessing on a tablet never blocks the
parents' own devices. All devices together stop after 50 failures for that account.

The device's choice of an adult profile is signed with a version that changes with the account's password. After a new
password, every device therefore asks for it again before the profile opens.

## Actions that ask again

The actions that can't be undone ask for the person's own password again, whatever session the device holds. A device
left open, or a stolen cookie, therefore can't do any of them:

- deleting one's account, or another adult's profile that has an account;
- a **New password** code for another adult, or handing over the household's admin role;
- installing or removing a plugin, or starting the developer mode;
- downloading or restoring a backup;
- deleting an account or a household in the _Server_ space.

The password is the one of the profile open on the device, and a wrong one counts against the throttle. An account
without a password of its own, made by a plugin's sign-in, shows a sign-in on that device in the last 5 minutes instead.

## Two-step verification

_Two-step verification_ (TOTP, RFC 6238) is required for the server's account and optional for every other adult, in
_Settings › Account and data_. Codes have 6 digits and 30-second steps, with one step of drift either way.

With it on, a sign-in asks for the app's code after the right password, and so does every action above. Each code
works once: the last step used is kept, and an older or equal one is refused. A wrong code counts against the
throttle, like a wrong password.

- **Turning it on** asks for the password, then the app's first code, within 15 minutes.
- **The secret** is sealed with AES-256-GCM, under a key derived from the session secret.
- **10 recovery codes** are shown once and kept as HMACs; each replaces the app's code once.
- **The server's account** can't turn it off, and the _Server_ space asks for it until it is on.

_Who's in?_ never asks for the app's code, as the device is already signed in. A new password, by code or by e-mail,
never signs such an account in on that device: it signs in again with the app's code.

## Throttling

Each client may fail 10 sign-ins, or setup codes, within 15 minutes. Further attempts are refused with `429` until its
oldest failure leaves the window. All clients together may fail 100 times in that window, which caps a guessing
attempt spread over many addresses.

A client is known by its connection's address. Behind a reverse proxy on the same machine or network, it is the last
`X-Forwarded-For` entry or `X-Real-IP`, the one the proxy added. Bots trying passwords from the internet therefore
never block the household's own sign-ins, and devices already signed in keep working in every case.

[← Back to security](../security.md)
