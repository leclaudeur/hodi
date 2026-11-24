# Reading

What a profile reads, watches, follows and shares.

## Articles

- **Feed**: every visible topic's articles, one day at a time in the account's time zone, with **Load** for earlier
  days. Several sources on the same story within 36 hours share one card, marked **Also on…**.
- **Topics**: some twenty, each with its own page. A profile reorders or hides them, picks its sources (_My sources_, filled from the _Catalogue_ page) and mutes
  words in _Settings_. A topic without any source is hidden from every list and from the sidebar.
- **[Reader](../reader.md)**: articles open inside Hodi. The server checks each one in the background and lists only those that open in
  the reader, with no paywall bypass. Sources marked `reader: false` show their summary and a link to the site.
- **Reading state**: an article counts as read once 80 % of it is scrolled and at least 35 % of its reading time has
  passed, with the tab visible. It counts as skimmed otherwise, and articles in progress come back under **Pick up**.
- **Saved**: the bookmark keeps an article and its text for good, even after it leaves the feeds.
- **History**: the articles opened in the last days.
- **Listen to article**: reads an article aloud with the device's own voice. Nothing is sent anywhere.
- **Search**: looks through every stored title and summary, ignoring case and accents.
- **Shortcuts**: on a computer, the keyboard moves through the lists and the reader. Press `?` to list them.

## Videos

The latest videos of the YouTube channels and the episodes of the podcasts the profile follows, from the last 60 days
by default, a length the server's admin sets in _Server › Content_. YouTube Shorts are left out.

## Followed and notifications

A profile follows subjects, such as "Iran" or "GTA 6". Matching articles carry a star and gather in **Followed**.

With notifications on, in _Settings › Notifications_, the server sends a push notification when a new article matches a
followed subject. That is one per subject every three hours at most, 12 a day at most, and none in the quiet hours.

> [!NOTE]
> Notifications need HTTPS (see [Deployment](../deployment.md#3-use-it-from-your-phone)). On an iPhone, add Hodi to the
> home screen first, with iOS 16.4 or later.

## Shared

**Send to…** sends an article or a video to another person, with a short note. It offers at once the family (parents,
children, brothers and sisters), the accounts signed in on the device and whoever the person shared with lately; any
other adult on the server is added by typing their @username. A teen or a child shares only within its family, and
nobody outside it can reach them. The receiver finds it in **Shared**, gets a notification and can react at the end of
the article. Turning sharing off, or muting one person, stops what they send.

Under a share received, at the end of the article, **Stop receiving their shares** mutes its sender at once (taken back
in Settings › Sharing), and **Report** tells the server's admin, with one reason (harassment, hateful, spam, something
else), that the share should not have come. Nothing happens to the sender on its own: the admin sees the share as it
was received, its note and its sender, never shown who reported it, and ignores it or blocks the sender's account. An
account reports a share once, and at most 5 a day.

[← Back to the features](../features.md)
