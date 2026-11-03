# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub instead: **Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it and which version (commit or tag) you run. You should get an answer within a week.

## Scope

Hodi is self-hosted: each install is run by its owner. Reports about the app itself are welcome (authentication, sessions, the SSRF guard on added sources, article sanitizing, container hardening). How the app is exposed (reverse proxy, firewall, Tailscale) is up to each install; see [docs/security.md](docs/security.md) for the defaults.
