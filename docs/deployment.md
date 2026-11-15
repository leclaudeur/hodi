# Deployment

Hodi runs as one Docker Compose project, on a computer or a server (VPS). You need **Docker with Compose v2** and about
**1 GB** of disk space: there is nothing else to install, and nothing to configure before the first start.

## 1. Install and start

```bash
git clone https://github.com/leclaudeur/hodi.git hodi
cd hodi
docker compose up -d
docker compose ps        # → hodi-app … (healthy)
```

The first start builds the image, which takes a few minutes. Hodi is ready when `docker compose ps` says `healthy`. It
listens on `http://127.0.0.1:3000`, on this machine only, and keeps the keys made at its first start in the `hodi-data`
volume.

## 2. First run

Open <http://localhost:3000> in a browser on the same machine. Hodi walks you through its setup:

1. **Account**: your e-mail and password, 8 characters or more. This account is yours, and it runs the server.
2. **The server is ready**: create the household now, or go to the _Server space_ first and create it later.
3. **Your household**: its name. It has no password: everyone gets their own account.
4. **And who are you?**: your profile's name, colour and photo. Up to 4 more profiles come later.
5. **AI, if you like**: a key from an AI provider, checked for free, or **No AI**.
6. **All set**: your time zone and country, guessed from the browser.

Your account exists as soon as you leave the first step: if you stop there, sign in from any device to carry on.
Everything chosen here can be changed later in _Settings › Household_ and _Settings › AI & credits_.

> [!TIP]
> Put plugins in `data/plugins/` before the first start: the setup then shows them under _Plugins found_, right after
> your account.

### The setup code

Opened from another network, through a reverse proxy for instance, the setup first asks for a code. It is in the
server's log:

```bash
docker compose logs app | grep "Setup code" | tail -1
```

Each start draws a new code, so take the last line. On the machine itself or on your local network, no code is asked.
The code stops a stranger who finds a fresh install from claiming it before you, and the setup closes for good once it
is done.

> [!WARNING]
> Hodi spots a proxy by the header it adds (`X-Forwarded-For`, `X-Real-IP` or `Forwarded`). A plain TCP relay, such as
> an `ssh -R` tunnel, adds none. Finish the setup before you open access through one.

## 3. Use it from your phone

Browsers keep the session only on HTTPS or on `localhost`, and the installable app and its notifications need HTTPS
too. To use Hodi from another device, put an **HTTPS reverse proxy** in front of it.

With a domain pointing at the server, [Caddy](https://caddyserver.com) gets and renews the certificate on its own. Its
`Caddyfile` takes three lines:

```text
hodi.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Nginx, Traefik, Tailscale or Cloudflare Tunnel work the same way, as long as they serve HTTPS.

### Changes for one machine

Anything specific to one machine goes in a `compose.override.yml`, next to `compose.yml`. Compose reads it on its own
and Git ignores it, so `git pull` never touches it. For example, to publish Hodi on another port:

```yaml
services:
  app:
    ports: !override
      - '0.0.0.0:8080:3000'
```

`!override` needs Compose 2.24 or later. Files that an override needs go in `local/`, which Git ignores too.

## Without a shell on the server (Portainer)

On a server reached only through a web UI such as [Portainer](https://www.portainer.io), nothing can be cloned or built
there. Hodi then comes as a ready-made image, `ghcr.io/leclaudeur/hodi`, published with each version for Intel or AMD
and ARM processors, and everything else happens in the browser:

1. **Start it**: _Stacks › Add stack_, paste [`compose.image.yml`](../compose.image.yml), then _Deploy the stack_. The
   image holds the feed list and the game's rules, so the stack needs no other file.
2. **Choose the port**: in the stack's environment variables, `HODI_PORT` is the server's port (3000 by default), and
   `HODI_BIND=0.0.0.0` opens it to the network, for a reverse proxy on another machine or container. Without
   `HODI_BIND`, Hodi only answers on the server itself.
3. **Set it up**: the setup code is in the container's _Logs_, on the line `Setup code`.
4. **Add plugins**: _Server › Plugins_ installs them from Hodi's list or from a `.hodi-plugin` file.

To update, change the image's tag in the stack, or keep `latest` and pull it again, then _Update the stack_.

## Update

```bash
git pull
docker compose up -d --build
docker compose ps
```

Database changes apply on their own at start. Dependabot proposes the updates of the base image and of the
dependencies every week, as pull requests that the maintainer reviews.

> [!TIP]
> Make a copy first: _Server › Backups › Back up now_.

## Roll back

```bash
git log --oneline -5
git checkout <previous-commit>
docker compose up -d --build
```

Go back to the latest version with `git checkout main`.

> [!IMPORTANT]
> A rollback across a database change is not supported. Restore a copy made before the update instead.

## Backups

Hodi copies its database and the plugins' data every night and keeps the last 7 copies. _Server › Backups_ changes
that number, from 1 to 30, and downloads or restores a copy. The copies live in the `hodi-data` volume. To copy them out
of it:

```bash
docker compose cp app:/app/data/backups ./hodi-backups
```

## Sign out every device

A new password in _Settings › Account and data_ signs out that account's other devices. To sign out every device of
every account, yours included, delete the session key and restart:

```bash
docker compose exec app rm /app/data/session-secret
docker compose restart app
```

## Logs

```bash
docker compose logs -f app
```

Logs are capped at 3 files of 10 MB.

## Disk usage

Hodi writes nothing outside Docker:

- the app image;
- the `hodi-data` volume: the database and its copies, a few hundred MB at most, as article text goes after 7 days by default;
- the container's logs, 30 MB at most.

```bash
docker system df
```

## Uninstall

```bash
docker compose down --volumes --rmi local
```

> [!WARNING]
> This deletes the database and every copy. Download one first if you want to keep your data.

Then delete the `hodi` folder.

[← Back to the README](../README.md)
