# The server

Hodi serves the app with strict HTTP headers, and runs in a container with as few rights as it can.

## HTTP headers

- **`Content-Security-Policy`**: `'self'` only, with no inline scripts and no framing.
- **`Strict-Transport-Security`**: one year.
- **`Referrer-Policy`**: `no-referrer`, so article links never leak the app's address.
- **`X-Robots-Tag`**: `noindex, nofollow`, with a `robots.txt` that disallows everything. The only exception is a
  plugin's [public pages](../../plugin-sdk/README.md#public-pages), such as Village's welcome page: once the admin has
  given Hodi's address, those few addresses say `index, follow` to a signed-out visitor, and `robots.txt` and
  `sitemap.xml` list them. Every other answer, the API included, keeps `noindex`.
- **`Cache-Control`**: `no-store` on every API response.

`/health` is public, and only answers `{"status":"ok"}`.

## Request limit

Each address may send 3,000 requests a minute, far above what a household's devices ask for, even a feed that loads all
its pictures at once. Past that, the server answers `429` until the minute is over, which slows a flood without
touching anyone else. The address is found as for the [sign-in throttle](sign-in.md#throttling), and requests from the
machine Hodi runs on are never counted.

## The container

- **Port**: 3000, published on `127.0.0.1` by default.
- **Root filesystem**: read-only.
- **Linux capabilities**: none (`cap_drop: ALL`), and `no-new-privileges`.
- **User**: `node`, never root.
- **Limits**: 256 MB of memory and 128 processes.
- **Mounts**: `sources.yml` and `gamification.yml` read-only, and the `hodi-data` volume, its only writable place.

The container never mounts the Docker socket.

## Uploaded photos

A profile photo is kept only when its bytes are the WebP, JPEG or PNG picture its type claims, read by sharp from the
file's header. An SVG, a page or a script sent as `image/png` is refused, so a photo's address only ever serves a
picture.

## The repositories

The GitHub Actions workflows use each action by the full SHA of its release commit, with the version in a comment.
A moved tag can't change what runs in CI or in the npm release, and Dependabot updates both together.

Every change reaches `main` through a reviewed pull request, and only the maintainer can merge one. Secret scanning
refuses a push that holds a key, CodeQL reads every change, and the workflows' own token can only read the code.

The npm release runs only in a release environment, with Trusted Publishing, so no npm token is stored anywhere. Each
official plugin's repository keeps its signing key the same way, in a release environment that only a release reaches.

[← Back to security](../security.md)
