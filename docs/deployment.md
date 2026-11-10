# Deployment

Hodi runs as one Docker Compose project, on a computer or a server (VPS). You need Docker with Compose v2, and about 1 GB of disk space.

## 1. Install and start

```bash
git clone https://github.com/leclaudeur/hodi.git hodi
cd hodi
docker compose up -d
docker compose ps
```

The first start builds the image, which takes a few minutes. The app is ready when `docker compose ps` shows it `healthy`. It listens on `http://127.0.0.1:3000`, on this machine only.

There is nothing to configure before the first start: the keys that sign sessions and notifications are generated then and kept in the `hodi-data` volume.

## 2. First run

Open <http://localhost:3000> in a browser on the same machine. Hodi shows its setup screens:

1. **Crée ton foyer**: the household's name and its password, shared by every profile (8 characters minimum).
2. **Et toi, c'est qui ?**: the admin profile's name, colour and photo. You can add up to 4 more profiles later.
3. **L'IA, si tu veux**: an API key from a provider (Claude today), checked with a request that costs no credits, or "Sans IA". You can add, replace or remove the key later in Réglages > IA et crédits.
4. **Tout est prêt**: the time zone (when the day changes, quiet hours) and the country (where the AI places your questions), guessed from the browser.

You are then signed in. Everything chosen here can be changed later by the admin in Réglages > Foyer.

### The setup code

When the setup screens are opened from another network, for example through a reverse proxy on a server, they first ask for a 6-digit setup code. Only whoever can read the server's log knows it:

```bash
docker compose logs app | grep "Setup code" | tail -1
```

Each start of the server draws a new code, and the log keeps the old ones: the last line is the current code.

This stops a stranger who finds a fresh install on the internet from claiming it before you do. On the machine itself or on your local network, the code is not asked. Hodi recognises a proxy by the forwarding header it adds (`X-Forwarded-For`, `X-Real-IP` or `Forwarded`); a plain TCP relay (an `ssh -R` tunnel, socat) or a proxy set up not to send them adds none, so finish the setup before opening access through one. Once the household is set up, the setup screens are closed for good.

## 3. Use it from other devices

Browsers keep the session cookie only on HTTPS or on `localhost`, and the installable app and notifications need HTTPS too. To use Hodi from a phone, put an HTTPS reverse proxy in front of it.

### HTTPS with Caddy

With a domain pointing at the server, [Caddy](https://caddyserver.com) gets and renews the certificate on its own. A `Caddyfile`:

```text
hodi.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Any other reverse proxy (Nginx, Traefik) or a private network tunnel (Tailscale, Cloudflare Tunnel) works the same way, as long as it serves HTTPS.

### Machine-specific changes

Anything specific to one machine goes in a `compose.override.yml` next to `compose.yml`. Compose (2.24 or later for `!override`) reads it on its own and Git ignores it (as it ignores `local/`, for files such an override needs), so `git pull` never touches it. For example, to publish Hodi on another port, or on every network interface when a firewall or proxy on another machine protects it:

```yaml
services:
  app:
    ports: !override
      - '0.0.0.0:8080:3000'
```

Optional environment variables, set the same way under `environment:`:

| Variable      | Default | Meaning                                        |
| :------------ | :------ | :--------------------------------------------- |
| `MAX_SOURCES` | `200`   | The household's sources, all profiles together |

## Update

```bash
git pull
docker compose up -d --build
docker compose ps
```

Database changes apply on their own at start. The base image is pinned by digest in the `Dockerfile`; Dependabot proposes its updates, and the dependencies', as weekly pull requests.

## Rollback

```bash
git log --oneline -5
git checkout <previous-commit>
docker compose up -d --build
```

Return to the latest version afterwards with `git checkout main`. A rollback across a database change is not supported: restore a backup made before the update (below).

## Backups

The `hodi-data` volume holds the database, a backup made every night (the last 7 are kept) and the generated keys. To copy the backups out of the volume:

```bash
docker compose cp app:/app/data/backups ./hodi-backups
```

## Sign out every device

Changing the household's password in Réglages > Foyer signs out every other device. To sign out all of them, this one included, delete the session key and restart:

```bash
docker compose exec app rm /app/data/session-secret
docker compose restart app
```

## Logs

```bash
docker compose logs -f app
```

Logs are capped at 3 × 10 MB.

## Uninstall

```bash
docker compose down --volumes --rmi local
```

This deletes the database and every backup. Then delete the folder.

## Disk usage

Nothing but Docker data is written:

- the app image
- the `hodi-data` volume: the SQLite database and its last 7 nightly backups (a few hundred MB at most, as article text is dropped after 7 days)
- container logs, capped at 30 MB

```bash
docker system df
```

[← Back to the README](../README.md)
