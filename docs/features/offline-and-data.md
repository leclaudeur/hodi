# Offline and stored data

## Offline and installable

Hodi installs as an app: _Add to Home Screen_ on a phone, _Install_ in a desktop browser. It keeps the last lists and up
to 200 opened articles on the device for offline reading, and sends what changed offline once the device is back
online. Signing out clears what the device kept.

## What is stored

Everything lives in a SQLite database in the `hodi-data` volume (`/app/data/hodi.db`, or `./data` outside Docker),
copied every night:

- the household's settings and its AI key;
- each account: e-mail, password hash and signed-in devices;
- the profiles: settings, saved articles, history (a year, 5,000 articles at most), statistics (400 days), followed
  subjects and the devices that get its notifications;
- every article the feeds listed, with a full-text index of titles and summaries;
- the reader text of each article for 7 days by default, and of saved articles for good;
- each source's icon, looked for again every 30 days;
- which profiles opened Hodi each day of the last month, shown in _Overview_ as a number per day;
- the whole server's totals of each day, kept for good for _Overview_: visits, reads, videos, time, shares, profiles,
  accounts, and the reads of each topic and source, never one profile's;
- the AI output already paid for, shown again for free, and the API calls of the last day, so the caps hold across
  restarts.

[← Back to the features](../features.md)
