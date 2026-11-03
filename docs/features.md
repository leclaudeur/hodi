# Features

What each part of Hodi does, and what it keeps. The interface is in French, so screen names are given as they appear.

## The household

- One install is one household, set up in the browser on the first visit (see [Deployment](deployment.md#2-first-run)).
- The household has one password, shared by every profile, and up to 5 profiles. The first one is the admin: it creates and deletes the others, manages the household's sources, its AI key and its settings (Réglages > Foyer).
- A profile can be made private with a code, asked before it opens. The admin can remove a forgotten code.
- One way to change profile per device: on a computer, the selector at the sidebar's foot (the admin can also create a profile from it); on a tablet or a phone, "Qui lit ?", from the header's avatar.
- Each profile has its own settings, saved articles, reading history, followed subjects and stats, kept on the server and shared by every device it is opened on.
- Réglages > À propos shows the version, a link to the source code (AGPL-3.0) and the credits: who made Hodi, and where its images, icons and fonts come from.

## Reading

- **Le fil** lists every visible theme's articles one day at a time, in the household's time zone, with "Charger plus" for earlier days. When several sources cover the same story (similar titles within 36 hours), the newest article gets the card and the others are listed with it ("Aussi sur…").
- **Themes**: some twenty themes, each with its own page. A profile reorders or hides them, hides sources and mutes words in Réglages. Themes without any source are hidden.
- **Reader view**: articles open inside Hodi. The server checks each one in the background and lists only the articles that open in the reader: subscriber-only or too short articles are hidden, with no paywall bypass. Sources marked `reader: false` show their summary and a link to the site instead.
- **Reading state**: an article counts as read once 80 % of it is scrolled and at least 35 % of its estimated reading time has passed (with the tab visible), and as skimmed otherwise. Articles in progress show up again on top of Le fil ("Reprendre").
- **Enregistrés**: the bookmark keeps an article and its text for good, even after it leaves the feeds.
- **Historique** lists the articles opened in the last days.
- **Écouter** reads an article aloud with the device's own voice; nothing is sent anywhere.
- **Search** looks through every stored title and summary, ignoring case and accents.
- On a computer, keyboard shortcuts move through the lists and the reader; `?` lists them.

## Vidéos

The latest videos of the YouTube channels and the episodes of the podcasts the profile follows, from the last 60 days. YouTube Shorts are left out.

## Suivis and notifications

- A profile follows subjects ("Iran", "GTA 6"…): matching articles carry a star and gather in **Suivis**. A search can be followed in one tap.
- With notifications on (Réglages > Notifications), the server sends a push notification when a new article matches a followed subject: one per subject every three hours at most, 12 a day at most, none during the chosen quiet hours. On an iPhone, Hodi must be added to the home screen first (iOS 16.4 or later).
- Notifications need HTTPS (see [Deployment](deployment.md#3-use-it-from-other-devices)).

## Partages

Once the household has two profiles, **Partages** sends an article or a video to another profile, with a short note. The receiver gets a notification and can react at the end of the article. Muting a profile hides what it sends.

## AI, optional

The admin adds an API key in Réglages > IA et crédits (Claude, from Anthropic, today). Billing is by use, on the key owner's account, separate from any chat subscription. Every AI feature runs only after a click on a purple button, never on its own:

- **Résumer avec l'IA**: the key points of an article, in French. Each summary is made once and kept.
- **Envie d'en savoir plus ?**: a question about an article, answered from it and, when needed, from a few web searches, with links to the pages used.
- **Résumé du jour**: a short summary of the day's news, theme by theme, for the profile. It can be updated once it is 30 minutes old.

Daily caps protect the credits: 100 summaries, 100 questions and 8 Résumé du jour a day for the household, shared equally between the profiles. The page shows what each profile used, and the admin can reset a counter.

## Statistiques

Articles and videos read this week and over 30 days, estimated reading time, the most read themes and sources. Kept on the server, per profile.

## The household game

Reading earns points, by the rules in `gamification.yml` (up to a daily cap). Only articles and videos a feed listed earn, with the theme and the publication time the server knows, and a profile counts at most 60 articles, 60 videos, 20 alerts, 20 shares and 20 reactions a day, for points and badges alike. Points raise a profile's level, shown as the ring around its avatar filling up to the next one, and earn badges in bronze, silver and gold. Tapping an avatar (in the header, Réglages > Profils, the week's ranking) opens that profile's sheet: its grade, the next one and its points, then its badges as a grid of cards. On its own sheet a profile sees every badge, those still to earn dimmed with their progress, and taps an earned one to wear it on its avatar (shown on avatars of 44 px and more). On a tablet or a phone, its own sheet also has "Changer de profil". With the game off there is no sheet.

Statistiques opens on the household's week: the weekly challenge (articles to read together by Sunday, set from the weeks before) and the ranking by this week's points; each row opens that profile's sheet. The admin turns the game off in Réglages > Foyer: nothing of it shows then, and points keep counting.

## Offline and installable

Hodi installs as an app (Add to Home Screen on a phone, Install in a desktop browser). Its service worker keeps the last lists and up to 200 opened articles on the device for offline reading. Changes made offline are sent once the device is back online. Signing out clears what the device kept.

## What is stored

Everything lives in a SQLite database in the `hodi-data` Docker volume (`/app/data/hodi.db`, or `./data` outside Docker), with a nightly backup (the last 7 are kept):

- the household's settings, its password hash and its AI key;
- the profiles and their state: settings, saved articles, reading history (a year, 5,000 articles at most), stats (400 days), followed subjects and push subscriptions;
- every article the feeds listed, with a full-text index of titles and summaries, so lists and search are complete right after a restart;
- the reader text of each article for 7 days (the title and link are kept for good), and the text of saved articles for good;
- each source's icon, looked for again every 30 days;
- the AI output already paid for, shown again for free, and the API calls of the last day, so the daily caps hold across restarts.

[← Back to the README](../README.md)
