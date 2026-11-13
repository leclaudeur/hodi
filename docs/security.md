# Security

A Hodi install that is reachable from the internet will be found by bots, since HTTPS certificates are listed in public
logs. Hodi protects it with a setup code, each person's own password, HTTPS from the reverse proxy and a hardened
container. Each of these parts has its own page below, with the details of how it works.

> [!IMPORTANT]
> To report a vulnerability, follow [SECURITY.md](../SECURITY.md) and never open a public issue.

## [First run](security/first-run.md)

Until the household is set up, the server answers nothing but the setup screens. A browser that reaches them from
another network must first type a setup code, which only the server's log shows, and the setup can run only once.

## [Sign-in and sessions](security/sign-in.md)

Each person signs in with their own e-mail and password, kept only as a scrypt hash, and gets a signed session cookie.
Adult profiles ask for their password again, the actions that can't be undone ask for it once more, and two-step
verification adds an app's code. Failed attempts are throttled per device and for the whole server.

## [Secrets](security/secrets.md)

Nothing secret lives in the repository or in environment variables. The server writes its own keys into its data
volume on the first start, and the database keeps only hashes, apart from the AI key.

## [The server](security/server.md)

Every response carries strict HTTP headers, and the container runs read-only, as a plain user, with no Linux
capability. A profile photo is kept only when it really is a picture. On GitHub, every change to the code is reviewed,
CI runs actions pinned to a commit, and no key or token is ever stored in any of the repositories.

## [Outgoing requests](security/outgoing-requests.md)

Hodi fetches news for its users, so it must never become a proxy to any address. Every request is checked before it
leaves, the reader opens only articles a feed listed, and their HTML is cleaned twice before it is shown.

[← Back to the README](../README.md)
