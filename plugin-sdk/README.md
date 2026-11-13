<div align="center">

# 🧩 Hodi plugin SDK

**Build, type and test plugins for [Hodi](https://github.com/leclaudeur/hodi), the self-hosted news reader for a
household.**<br>
One command builds the file Hodi installs. _Your plugin runs in Hodi's sandbox, with Hodi's own look._

[![npm](https://img.shields.io/npm/v/@hodi-app/plugin-sdk?label=%40hodi-app%2Fplugin-sdk)](https://www.npmjs.com/package/@hodi-app/plugin-sdk)
[![Node.js 24 or later](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/leclaudeur/hodi/blob/main/LICENSE)

[**Quick start**](#quick-start) · [**Server part**](#the-server-part) · [**Web part**](#the-web-part) ·
[**Testing**](#testing) · [**Signing**](#signing)

</div>

## Why a plugin

A Hodi **plugin** adds a feature to Hodi _without touching its code_. The server admin installs it from
_Server › Plugins_, and this package gives it everything it needs:

- 🧱 **the build**, which makes the `.hodi-plugin` file Hodi installs
- 🔁 **a live loop**: each save reinstalls the plugin on your test Hodi
- 🎨 **Hodi's components**, so the plugin looks like the rest of the app
- 🔒 **a sandbox** with its own database, and only the permissions it asks for
- 🧪 **a test kit** that runs your routes as Hodi does, in memory

> [!TIP]
> The quickest start is [`hodi-plugin-template`](https://github.com/leclaudeur/hodi-plugin-template): a working
> plugin, with its build, its tests and its CI.

## Quick start

1. Add the SDK to the plugin's folder:

   ```bash
   npm install --save-dev @hodi-app/plugin-sdk
   ```

2. On a test Hodi, turn on _Server › Plugins › Developer mode_ and copy the code it shows once.

3. Run the plugin in that Hodi, rebuilt at each save:

   ```bash
   npx hodi-plugin dev --server http://localhost:3000 --code <code>
   ```

4. Build the file to install:

   ```bash
   npx hodi-plugin build    # into dist/<id>-<version>.hodi-plugin
   ```

A plugin sent by `hodi-plugin dev` shows as **In development**. Its pages show although it is unsigned, and it keeps its data between builds.

## What a plugin can do

- 🗄️ **Keep its own data**, in a database of its own
- 🌐 **Read other sites**, only the ones it names
- ⚙️ **Have settings** that Hodi draws for it
- 📄 **Add pages** to _Settings_ and to the _Server_ space, and cards to its _Overview_
- 📰 **Offer feeds** a household follows like any source
- ✨ **Use the household's AI**, only on a click
- 🔔 **Send notifications** and e-mails
- 🚪 **Join the sign-in**, for a sign-up or another way in
- 🔎 **Open pages to search engines**, such as a public home page

Each power is a permission: Hodi shows the list to the admin before the install, and refuses anything else.

## A plugin's folder

```text
my-plugin/
  plugin.json        what it is: its name, who it is for, its settings and permissions
  server/index.ts    its server part
  web/index.tsx      its web part
  locales/fr.json    its texts, one file per language
```

Each language's file also gives the plugin's name and description in that language, in a `manifest` object. Give both
in every file, even when they read the same as in `plugin.json`: a name may differ from one language to another. They
follow `plugin.json`'s limits (60 and 280 characters), and Hodi falls back on `plugin.json` when one is missing:

```json
{
  "manifest": {
    "name": "Hello world",
    "description": "A sample plugin: a setting, a route and its own card."
  }
}
```

The **server part** runs in Hodi's sandbox, with its own database. It reaches the outside only through what Hodi gives
it, and only with the permissions it asked for.

The **web part** is drawn with Hodi's own components, buttons and colours. The plugin looks like the rest of Hodi, in
every theme and on every screen size.

## Public pages

A plugin that draws the signed-out screens (`permissions.publicRoutes` and a `web-public.js`) can open some addresses to
search engines. List them in `plugin.json`, each with its language; a route's own `title`, `description` or `image`
replaces the plugin's `defaults`, and a route with neither gets Hodi's own:

```json
"publicPages": {
  "defaults": {
    "title": "Hodi - The news for the whole family",
    "description": "…",
    "image": "assets/share.png"
  },
  "routes": [
    {
      "path": "/",
      "lang": "fr"
    },
    {
      "path": "/en",
      "lang": "en"
    },
    {
      "path": "/legal",
      "lang": "fr",
      "title": "Mentions légales"
    }
  ]
}
```

Hodi writes these in the `<head>` it sends for those addresses only, with their links to each other's languages (`/en`
is `/` in English, `/en/legal` is `/legal`), and lists them in `robots.txt` and `sitemap.xml`. The page itself is your
signed-out page, as always. `defaults` is in `plugin.json`'s language; each locale file translates it in a
`publicPages` object (`title`, `description`). The image is 1200 × 630. Nothing is indexed until the server's admin
gives Hodi's address (_Server › E-mail_), and every other address stays out of search engines.

## Testing

The SDK runs a plugin's server part as Hodi does: it builds the plugin, loads it in Hodi's own sandbox and calls its
routes through Hodi's own checks. Around it is a small Hodi in memory, with a household, the people a test adds and
stand-ins for sites, e-mails, notifications and the AI, so a test never sends anything.

In the template, `npm test` runs these tests on your machine, and CI runs them again on every push. A plugin that passes
them behaves the same way once it is installed in a real Hodi.

## Signing

A signature tells Hodi who made a plugin. Anyone can sign theirs with an ed25519 key (`hodi-plugin build --key
private.pem`), but Hodi only trusts its maintainer's key: every other plugin installs as **Unverified code**, after the
admin confirms a second time that they trust where it comes from.

To have your plugin **Verified**, publish it in a public repository with a release, then open a pull request that adds
it to [Hodi's plugin registry](https://github.com/leclaudeur/hodi-plugin-registry). The maintainer reads its code, and
signs that version with Hodi's key once it follows Hodi's rules. Each new version is read again before it is signed.
Once listed, it shows under _Server › Plugins › Available_ in every Hodi, ready to install.

An unsigned plugin's server part runs as usual, but its pages never show outside Developer mode. They would run in
Hodi's page with the profile's session, so only a signed plugin, or one you are writing, may draw them.

> [!WARNING]
> Keep a private key out of every repository and plugin folder.

## Hodi's rules

- ✨ **No AI without a click**: only Hodi's AI button asks it
- 🗣️ **Every text in the locales**, and French says « tu »
- 🔐 **People's data**: say what you keep, delete it when they go

## Going further

- 🧩 **[The template](https://github.com/leclaudeur/hodi-plugin-template)**: a working plugin to start from
- 👋 **[Hello world](https://github.com/leclaudeur/hodi/tree/main/plugin-sdk/test/hello-world)**: the SDK's own example, small and complete
- 📘 **The types**: every option and limit is commented in the package's types
- 🛠️ **The commands**: `npx hodi-plugin --help`

## License

Copyright © 2026 Le Claudeur and the Hodi contributors.

The plugin SDK is free software under the [GNU AGPL-3.0](https://github.com/leclaudeur/hodi/blob/main/LICENSE), like
Hodi itself: you may **use, change and share** it freely.
