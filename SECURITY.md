# Security

Found a security problem in Hodi? Thank you for reporting it privately, so that it can be fixed before anyone can use
it. This page explains how to report it, and which parts of Hodi a report can be about.

## Reporting a vulnerability

> [!IMPORTANT]
> Never open a public issue for a security problem.

Report it privately on GitHub instead: the repository's _Security_ tab, then **Report a vulnerability**. Say what you
found, how to reproduce it and which version you run, a commit or a tag. You should get an answer within a week.

## Scope

Hodi is self-hosted, so each install is run by its owner. Reports about the app itself are welcome, for example:

- **Authentication**: passwords, two-step verification and one-time codes;
- **Sessions**: cookies, sign-out and the profile lock in _Who's in?_;
- **Outgoing requests**: the guard that stops an added source from reaching a private address;
- **Articles**: how their HTML is cleaned before it is shown;
- **The container**: its hardening and what it can write.

How an install is exposed, through a reverse proxy, a firewall or a tunnel, is up to its owner.\
The [security guide](docs/security.md) describes Hodi's defaults and how each of its protections works.
