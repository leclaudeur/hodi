# Security

A Hodi install reachable from the internet will be found by bots (HTTPS certificates are listed in public Certificate Transparency logs). Protection relies on the setup code, the household's password, HTTPS from the reverse proxy and hardened containers.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## First run

- Until the household is set up, every API route except the setup screens' answers `setup_required`, and login is refused.
- A browser that reaches the server through a reverse proxy or from a public address must enter the 6-digit setup code printed in the server's log at start (see [Deployment](deployment.md#the-setup-code)). On the machine itself or a private network, it is not asked. A request counts as remote when it carries `X-Forwarded-For`, `X-Real-IP` or `Forwarded`: a proxy or tunnel that adds none of them (a plain TCP relay such as `ssh -R` or socat, or a misconfigured proxy) makes every visitor look local, so finish the setup before opening access through it. Wrong codes count against the login throttle below.
- The setup can only run once: a second attempt is refused once a password exists.

## Authentication

- One password per household, stored only as an scrypt hash (`N=32768, r=8, p=1`) in the database, 8 characters minimum.
- A successful login sets a signed, stateless session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, valid 90 days. Browsers accept `Secure` cookies on HTTPS and on `localhost` only.
- The cookie is signed with a key derived from the server's session secret and the current password hash: changing the password in Réglages > Foyer signs out every other device, and the device that changed it gets a new cookie.
- Logging out clears the cookie on that device. To sign out every device, see [Deployment](deployment.md#sign-out-every-device).
- Every `/api/*` route except login, logout and the setup screens requires a session. Household settings, profile management and the AI key require the admin profile. The web bundle holds no data and is public, so the login page can load.
- A private profile's code and the Code parental are checked on the server. Each device may fail a given code 5 times within 15 minutes, so a child guessing a parent's PIN on its tablet never blocks the parents' own devices; all devices together stop after 50 failures.
- `/health` is public and only returns `{"status":"ok"}`.

### Login throttling

Each client may fail 10 logins (or setup codes) within 15 minutes; further attempts from it are refused with `429` until its oldest failure leaves the window. All clients together may fail 100 times in that window, which caps a guessing attempt spread over many addresses.

A client is known by its connection's address. Behind a reverse proxy on the same machine or network (a private address), it is the last `X-Forwarded-For` entry or `X-Real-IP`, the one the proxy added. Bots trying passwords from the internet therefore no longer block new logins for the household; devices already signed in keep working in every case.

## Secrets

Nothing secret lives in the repository or in environment variables. On the first start, the server writes into the `hodi-data` volume, readable by its user only (mode `600`):

- `session-secret`: signs the session cookies;
- `vapid.json`: the key pair that signs push notifications.

The database holds the password hash and the AI provider's API key. The key is sent only to its provider, and the admin page shows only its first characters and last four. Keep the backups (`/app/data/backups`) as private as the volume itself.

## HTTP headers

| Header                      | Value                                                    |
| :-------------------------- | :------------------------------------------------------- |
| `Content-Security-Policy`   | `'self'` only, no inline scripts, no framing             |
| `Strict-Transport-Security` | one year                                                 |
| `Referrer-Policy`           | `no-referrer`, article links do not leak the app URL     |
| `X-Robots-Tag`              | `noindex, nofollow`, plus a `robots.txt` disallowing all |
| `Cache-Control`             | `no-store` on every API response                         |

## Containers

| Setting                   |              app              |
| :------------------------ | :---------------------------: |
| Published host ports      | 3000 on `127.0.0.1` (default) |
| Read-only root filesystem |              yes              |
| Linux capabilities        |    none (`cap_drop: ALL`)     |
| `no-new-privileges`       |              yes              |
| Non-root user             |         yes (`node`)          |
| Memory / process limits   |         256 MB / 128          |

The container does not mount the Docker socket. It mounts `sources.yml` and `gamification.yml` read-only, and the `hodi-data` volume, its only writable place.

## Outgoing requests

The app fetches news on behalf of its users, so it must not become a proxy to arbitrary addresses:

- Feeds come from `sources.yml` (when the household is set up) and from links profiles add, which go through an SSRF guard (no private, loopback or link-local addresses); the file's feeds must use HTTPS.
- An article opens in the reader only if a feed listed it: the API takes an item id, never a URL.
- The article URL, and the final URL after redirects, must be on one of the source's `domains`. Anything else, including a redirect to a login or paywall page, is reported as unreadable.
- Every request, and every redirect it leads to, is checked before it leaves: the name must resolve only to public addresses. A news site that redirects to the server's own network (a router, a cloud metadata address) gets no request.
- Every request has a 5 second timeout and a 5 MB size cap.
- Articles are extracted with Readability on the server and sanitized again in the browser before display.
- AI requests go only to the chosen provider, and only after a click.

[← Back to the README](../README.md)
