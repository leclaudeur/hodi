# Performance

Hodi is a news reader you open many times a day, often on a phone with a weak connection. It should show something fast and cost little battery. This page records how fast it is, how it was measured, and what made it fast, so a change that slows it down can be caught.

## Results

Lighthouse 12 performance scores on the 21 screens of the app, at three sizes, before and after the performance work of November 2026 (#389 to #396, #399):

| Page                | Phone       | Tablet      | Computer     |
| ------------------- | ----------- | ----------- | ------------ |
| Le fil              | 56 → **79** | 58 → **80** | 75 → **98**  |
| Belgique (topic)    | 57 → **80** | 56 → **76** | 67 → **98**  |
| Monde (topic)       | 55 → **82** | 58 → **75** | 68 → **99**  |
| Article (reader)    | 60 → **86** | 60 → **83** | 75 → **99**  |
| Une story           | 55 → **88** | 56 → **81** | 75 → **98**  |
| Vidéos              | 60 → **89** | 60 → **88** | 90 → **99**  |
| Plus tard           | 61 → **82** | 59 → **84** | 90 → **99**  |
| Suivis              | 58 → **83** | 58 → **83** | 90 → **99**  |
| Partages            | 60 → **86** | 59 → **89** | 90 → **99**  |
| Historique          | 60 → **87** | 59 → **86** | 90 → **99**  |
| Search              | 59 → **85** | 59 → **85** | 82 → **99**  |
| Résumé du jour      | 58 → **80** | 57 → **81** | 76 → **98**  |
| Profils             | 59 → **90** | 59 → **90** | 92 → **100** |
| Réglages            | 60 → **88** | 59 → **88** | 92 → **100** |
| Réglages › Lecture  | 59 → **90** | 60 → **89** | 92 → **100** |
| Réglages › Sources  | 60 → **89** | 60 → **89** | 92 → **100** |
| Statistiques        | 56 → **76** | 55 → **79** | 86 → **99**  |
| Réglages › Foyer    | 59 → **88** | 56 → **89** | 92 → **100** |
| Réglages › IA       | 59 → **88** | 60 → **89** | 92 → **100** |
| Réglages › À propos | 59 → **88** | 59 → **89** | 92 → **100** |
| Sign-in             | 60 → **89** | 60 → **88** | 92 → **100** |
| **Average**         | 59 → **85** | 58 → **85** | 85 → **99**  |

The other categories are 91 to 100 for accessibility and 96 to 100 for best practices. SEO is 54 to 58 on purpose: a household's Hodi is private and asks search engines not to index it.

Le fil, the screen opened most often:

|                            | Phone before | Phone after | Computer before | Computer after |
| -------------------------- | ------------ | ----------- | --------------- | -------------- |
| First text on screen (FCP) | 6.5 s        | 2.5 s       | 1.4 s           | 0.6 s          |
| Main picture or text (LCP) | 15.5 s       | 4.8 s       | 3.3 s           | 1.1 s          |
| Bytes downloaded           | 3.1 MB       | 560 KB      | 3.8 MB          | 554 KB         |

## The reports

Each picture is the top of the Lighthouse report for one screen, from the "after" run above.

**Computer:** eight screens score 100, and the screens full of pictures score 98 to 99.

![Réglages on a computer: performance 100](performance/desktop-reglages.png)
![An article on a computer: performance 99](performance/desktop-article.png)
![Le fil on a computer: performance 98](performance/desktop-fil.png)

**Phone** (Lighthouse's default mobile profile: a mid-range phone, slow 4G, CPU four times slower):

![Réglages › Lecture on a phone: performance 90](performance/mobile-lecture.png)
![An article on a phone: performance 86](performance/mobile-article.png)
![Le fil on a phone: performance 79](performance/mobile-fil.png)

**Tablet** (the same network and CPU as the phone, screen 820 × 1180):

![An article on a tablet: performance 83](performance/tablet-article.png)
![Le fil on a tablet: performance 80](performance/tablet-fil.png)

## How it was measured

- A fresh install from the production build (`npm run build`, `npm start`), set up once through the wizard. The household has no AI key.
- The data is 240 real articles from the bench's pages (Belgique, Monde…). Their pictures are 24 JPEG of 1600 × 900, about 160 KB each, the usual size of a news site's share picture. They are served over local HTTPS so the content security policy accepts them.
- Lighthouse 12 runs in headless Chromium with simulated throttling, one report per screen and size (63 reports).
  - Phone: Lighthouse's default mobile settings.
  - Tablet: the same settings with an 820 × 1180 screen at DPR 2.
  - Computer: Lighthouse's desktop settings.
- Run nothing else on the machine during the reports. Another process using the CPU shows up as blocking time: one report fell from 83 to 34 because of that.

Scores move by 2 or 3 points from one run to the next. Compare averages over several screens, not one report.

## What made it fast

- **Compression** (#389, #395): every answer is compressed. JS and CSS are precompressed with brotli at the highest level at build time and served with a one-year cache.
- **Pictures made smaller by the server** (#390, #391, #393): the first picture of a list loads first. The server downloads each article's picture once and makes three WebP widths (240, 480, 960) plus a tiny blurred preview with `sharp`. Cards, stories, related articles and the pictures inside an article ask for the width they need. An article's pictures keep their place before they load.
- **No blur on touch screens** (#392): the bottom bar, the header and the buttons over pictures use a solid background on phones and tablets. A blur makes the GPU work on every frame of scrolling.
- **The first requests start with the HTML** (#394): `web/public/preload.js` preloads the session, the profile, the feed and "À la une" while the app's code downloads.
- **Nothing moves while the home loads** (#396): skeletons hold the exact place of the stories row, the Reprendre pile and the list column.
- **Less work in the background** (#396): the 40 article downloads for offline reading wait until the app has shown, and a hidden app runs no timer.
- **One language** (#399): English is downloaded only by a household that reads in English.

## Battery

At rest, Hodi does almost nothing: 1 to 2 ms of CPU in 20 s, no layout, no request and no animation frame on every screen but a playing story. Battery goes to loading (radio and CPU) and to scrolling (GPU). The changes above cut both: about 80 % fewer bytes on the first load of Le fil, and no blur to redraw while scrolling on a phone.

## What is left

On a phone, every screen waits about 2.3 s before its first text: the browser downloads and runs about 230 KB of compressed JavaScript (React, the app, the shared components) before it can draw anything. Going further would need the server to send the first screen as HTML (an app shell or server rendering), a larger change than this work.
