import { type Browser, type Page, expect, test } from '@playwright/test'

// What Hodi cannot do without, on a fresh install, one journey after the other: set it up, read, save, search, add
// profiles and sources, sign in on other devices, share between profiles, and keep a teen to what its parents chose.
// The news sites are e2e/server.ts's pages. Alex (admin) uses `page`, Sam (adult) `sam` and Zoé (teen) `teen`.

const PASSWORD = 'un mot de passe solide 42'
const SAM_PIN = '2468'

test.describe.configure({ mode: 'serial' })

let page: Page
let sam: Page
let teen: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
})

test.afterAll(async () => {
  await Promise.all([page, sam, teen].filter(Boolean).map(open => open.close()))
})

// A new device: the household's password, then a profile (and its code when it is private).
const signIn = async (browser: Browser, name: string, options: Parameters<Browser['newPage']>[0] = {}) => {
  const device = await browser.newPage(options)
  await device.goto('/')
  await device.getByRole('textbox', { name: 'Mot de passe' }).fill(PASSWORD)
  await device.getByRole('button', { name: 'Entrer' }).click()
  await device.getByRole('button', { name: new RegExp(name) }).click()
  return device
}

// A profile's first time in Hodi starts the guided tour; skipped once, it does not come back.
const skipTour = async (device: Page) => {
  await device.getByRole('button', { name: 'Passer' }).click()
  await expect(device.getByRole('button', { name: 'Passer' })).toHaveCount(0)
  await device.reload()
  await expect(device.getByRole('link', { name: 'Réglages' }).first()).toBeVisible()
  await expect(device.getByRole('button', { name: 'Passer' })).toHaveCount(0)
}

// What the server does in the background (fetching a new source's feed) shows after a reload.
const afterReload = (device: Page, check: () => Promise<void>) =>
  expect(async () => {
    await device.reload()
    await check()
  }).toPass({ timeout: 20_000 })

// Opens an article from the search, where it stays once read or hidden.
const openFromSearch = async (device: Page, word: string, title: string) => {
  // From the fil: an open search screen keeps the words it has.
  await device.goto('/')
  await device.goto(`/#/recherche/${word}`)
  await device.getByRole('region', { name: 'Recherche' }).getByRole('link', { name: title }).click()
}

test('sets up the household in the browser', async () => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Commencer' }).click()
  await page.getByRole('textbox', { name: 'Nom du foyer' }).fill('Famille Test')
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirme le mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Continuer' }).click()
  await page.getByPlaceholder('Ex. Léa').fill('Alex')
  await page.getByRole('button', { name: 'Continuer' }).click()
  // Never a real AI key in a test.
  await page.getByRole('radio', { name: /Sans IA/ }).check()
  await page.getByRole('button', { name: 'Continuer' }).click()
  await page.getByRole('button', { name: 'Entrer dans Hodi' }).click()

  // Le fil, with the sites' articles of the day.
  await expect(page.getByText('Pluie record sur Bruxelles').first()).toBeVisible()
  await expect(page.getByText('La bourse de Paris recule').first()).toBeVisible()
})

test('opens an article in the reader', async () => {
  await page.getByText('Pluie record sur Bruxelles').first().click()
  await expect(page).toHaveURL(/#\/article\//)
  await expect(page.getByText('Pluie record sur Bruxelles, paragraphe 8.', { exact: false })).toBeVisible()
})

test('saves an article and finds it in Enregistrés', async () => {
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).first().click()
  await expect(page.getByText('Ajouté aux Enregistrés')).toBeVisible()
  await page.getByRole('link', { name: 'Enregistrés' }).first().click()
  const saved = page.getByRole('region', { name: 'Enregistrés' })
  await expect(saved.getByRole('link', { name: 'Pluie record sur Bruxelles' })).toBeVisible()
  await expect(saved.getByRole('link', { name: 'Le nouveau tram arrive à Liège' })).toHaveCount(0)
})

test('finds articles by a word, accents aside', async () => {
  await page.goto('/#/recherche/liege')
  const results = page.getByRole('region', { name: 'Recherche' })
  await expect(results.getByText('Le nouveau tram arrive à Liège').first()).toBeVisible()
  await expect(results.getByText('La bourse de Paris recule')).toHaveCount(0)
})

test('creates an adult and a teen profile', async () => {
  await page.goto('/#/reglages/profils')
  const dialog = page.getByRole('dialog', { name: 'Nouveau profil' })
  await page.getByRole('button', { name: 'Ajouter un profil' }).click()
  await dialog.getByRole('textbox', { name: 'Prénom' }).fill('Sam')
  await dialog.getByRole('button', { name: 'Créer le profil' }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Ajouter un profil' }).click()
  await dialog.getByRole('textbox', { name: 'Prénom' }).fill('Zoé')
  await dialog.getByRole('radio', { name: 'Ado' }).check()
  await dialog.getByRole('button', { name: 'Créer le profil' }).click()
  await expect(dialog).toHaveCount(0)

  const profiles = page.getByRole('main').getByRole('listitem')
  await expect(profiles.filter({ hasText: 'Sam' })).toContainText('Adulte')
  await expect(profiles.filter({ hasText: 'Zoé' })).toContainText('Ado')
})

test('adds a source from the link of its site', async () => {
  await page.goto('/#/reglages/sources')
  await page.getByRole('button', { name: 'Ajouter une source' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ajouter une source' })
  // A home page: Hodi finds the feed it names.
  await dialog.getByRole('textbox', { name: 'Lien de la source à ajouter' }).fill('gamma.example')
  await dialog.getByRole('button', { name: 'Chercher' }).click()
  await expect(dialog.getByText('Le vélo gagne du terrain à Namur')).toBeVisible()
  await dialog.getByRole('combobox', { name: 'Thèmes de la source' }).click()
  await page.getByRole('option', { name: 'Monde' }).click()
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click()
  // The dialog stays open, empty, for another source.
  await expect(dialog.getByRole('textbox', { name: 'Lien de la source à ajouter' })).toHaveValue('')
  await dialog.getByRole('button', { name: 'Fermer' }).click()
  await page.getByRole('button', { name: 'Mes sources 1' }).click()
  await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: 'gamma.example' })).toContainText('Gamma')

  await page.goto('/')
  await afterReload(page, () =>
    expect(page.getByRole('link', { name: 'Le vélo gagne du terrain à Namur' }).first()).toBeVisible()
  )
})

test('signs in from another device and picks a profile', async ({ browser }) => {
  const other = await signIn(browser, 'Alex')
  await expect(other.getByRole('link', { name: 'La bourse de Paris recule' })).toBeVisible()
  // What the profile did on the first device follows it: its saved article.
  await expect(other.getByRole('link', { name: 'Enregistrés 1' })).toBeVisible()
  await other.close()
})

test('reads on a phone', async ({ browser }) => {
  const phone = await signIn(browser, 'Alex', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await phone.getByRole('link', { name: 'La bourse de Paris recule' }).first().click()
  await expect(phone.getByText('La bourse de Paris recule, paragraphe 8.', { exact: false })).toBeVisible()
  await phone.close()
})

test('shares an article with and without a word, and the sender sees the reactions', async ({ browser }) => {
  const send = async (word: string, title: string, note: string) => {
    await openFromSearch(page, word, title)
    await page.getByRole('button', { name: 'Envoyer à un profil du foyer' }).click()
    const dialog = page.getByRole('dialog', { name: 'Envoyer à…' })
    await dialog.getByRole('checkbox', { name: 'Sam' }).check()
    if (note) await dialog.getByRole('textbox', { name: 'Un mot avec l’article' }).fill(note)
    await dialog.getByRole('button', { name: 'Envoyer' }).click()
    await expect(dialog).toHaveCount(0)
  }
  await send('bourse', 'La bourse de Paris recule', 'Regarde, ça va t’intéresser')
  await send('tram', 'Le nouveau tram arrive à Liège', '')

  sam = await signIn(browser, 'Sam')
  await skipTour(sam)
  await sam.getByRole('link', { name: /^Partages/ }).click()
  const shares = sam.getByRole('region', { name: 'Partages' })
  await expect(shares.getByRole('article').filter({ hasText: 'La bourse de Paris recule' })).toContainText(
    'Regarde, ça va t’intéresser'
  )
  await expect(shares.getByRole('article').filter({ hasText: 'Le nouveau tram arrive à Liège' })).toBeVisible()

  // With a word: the reader shows it above the article. A reaction at the end goes back to Alex.
  await shares.getByRole('link', { name: 'La bourse de Paris recule' }).click()
  const fromAlex = sam.getByRole('region', { name: 'Envoyé par Alex' })
  await expect(fromAlex).toContainText('Alex t’a envoyé cet article')
  await expect(fromAlex).toContainText('Regarde, ça va t’intéresser')
  await sam.getByRole('group', { name: 'Réagir pour Alex' }).getByRole('button', { name: '❤️' }).click()
  await expect(sam.getByRole('button', { name: '❤️' })).toHaveAttribute('aria-pressed', 'true')

  // Without a word: the article only says who sent it.
  await sam.getByRole('link', { name: /^Partages/ }).click()
  await shares.getByRole('link', { name: 'Le nouveau tram arrive à Liège' }).click()
  await expect(fromAlex).toContainText('Alex t’a envoyé cet article')
  await expect(fromAlex).not.toContainText('Regarde')
  await sam.getByRole('group', { name: 'Réagir pour Alex' }).getByRole('button', { name: '👍' }).click()
  await expect(sam.getByRole('button', { name: '👍' })).toHaveAttribute('aria-pressed', 'true')

  // Alex sees both reactions on top of its Partages.
  await page.goto('/')
  await page.getByRole('link', { name: /^Partages/ }).click()
  const reactions = page.getByRole('region', { name: 'Réactions à tes partages' })
  await expect(reactions.getByRole('link', { name: /Sam a réagi ❤️ La bourse de Paris recule/ })).toBeVisible()
  await expect(reactions.getByRole('link', { name: /Sam a réagi 👍 Le nouveau tram arrive à Liège/ })).toBeVisible()
})

test('makes a profile private: another device needs its code, then signs out', async ({ browser }) => {
  await sam.goto('/#/reglages/moi')
  await sam.getByRole('switch', { name: 'Profil privé' }).click()
  const dialog = sam.getByRole('dialog', { name: 'Rendre ton profil privé' })
  await dialog.getByRole('textbox', { name: 'Ton code (4 chiffres)' }).fill(SAM_PIN)
  await dialog.getByRole('textbox', { name: 'Encore une fois' }).fill(SAM_PIN)
  await dialog.getByRole('button', { name: 'Rendre privé' }).click()
  await expect(sam.getByRole('switch', { name: 'Profil privé' })).toBeChecked()

  const other = await signIn(browser, 'Sam')
  await other.getByRole('textbox', { name: 'Code PIN' }).fill('1111')
  await expect(other.getByText('Ce code n’est pas le bon.')).toBeVisible()
  await other.getByRole('textbox', { name: 'Code PIN' }).fill(SAM_PIN)
  await expect(other.getByRole('button', { name: 'Sam, ton profil' })).toBeVisible()

  await other.goto('/#/reglages')
  await other.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(other.getByRole('textbox', { name: 'Mot de passe' })).toBeVisible()
  // Signed out for good: the app does not open again without the password.
  await other.goto('/#/plus-tard')
  await expect(other.getByRole('textbox', { name: 'Mot de passe' })).toBeVisible()
  await other.close()
})

test('hides an article, finds it in Historique and makes it unread again', async () => {
  await sam.goto('/')
  const feed = sam.getByRole('region', { name: 'Le fil' })
  const pluie = feed.getByRole('article').filter({ hasText: 'Pluie record sur Bruxelles' })
  await pluie.getByRole('button', { name: 'Masquer l’article' }).click()
  await expect(pluie).toHaveCount(0)

  await sam.getByRole('link', { name: 'Historique' }).first().click()
  const hidden = sam
    .getByRole('region', { name: 'Historique' })
    .getByRole('article')
    .filter({ hasText: 'Pluie record' })
  await expect(hidden).toContainText('Masqué')
  await hidden.getByRole('button', { name: 'Marquer comme non lu' }).click()

  await sam.getByRole('link', { name: 'Le fil' }).first().click()
  await expect(feed.getByRole('link', { name: 'Pluie record sur Bruxelles' })).toBeVisible()
})

test('follows a subject from the search, in Suivis', async () => {
  await sam.goto('/#/recherche/bruxelles')
  await sam.getByRole('region', { name: 'Recherche' }).getByRole('button', { name: 'Suivre ce sujet' }).click()
  await expect(
    sam.getByRole('region', { name: 'Recherche' }).getByRole('button', { name: 'Sujet suivi' })
  ).toBeVisible()

  await sam.goto('/')
  await sam.getByRole('link', { name: 'Suivis' }).first().click()
  const followed = sam.getByRole('region', { name: 'Suivis' })
  await expect(followed.getByRole('link', { name: 'Pluie record sur Bruxelles' })).toBeVisible()
  await expect(followed.getByRole('link', { name: 'Le nouveau tram arrive à Liège' })).toHaveCount(0)
})

test('keeps an article left half read in Reprendre', async () => {
  await sam.goto('/')
  await sam.getByRole('link', { name: 'Le grand dossier de l’hiver' }).first().click()
  // A third of the way down, measured on the next frame, then back to the fil inside the app (leaving the reader
  // is when the position is kept): started, not read.
  await sam.getByText('Le grand dossier de l’hiver, paragraphe 20.', { exact: false }).scrollIntoViewIfNeeded()
  // Run in the page, which has the DOM this file's types do not.
  await sam.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
  await sam.getByRole('link', { name: 'Le fil' }).first().click()
  await afterReload(sam, () =>
    expect(
      sam.getByRole('region', { name: 'Reprendre' }).getByRole('link', { name: 'Le grand dossier de l’hiver' })
    ).toBeVisible({ timeout: 2000 })
  )
})

test('switches the interface to English and back', async () => {
  await sam.goto('/#/reglages/lecture')
  await sam.getByRole('radio', { name: 'English' }).click()
  await expect(sam.getByRole('heading', { name: 'Reading and display', level: 1 })).toBeVisible()
  await expect(sam.getByRole('link', { name: 'Settings' }).first()).toBeVisible()
  // The articles keep their own language.
  await sam.getByRole('link', { name: 'Feed' }).first().click()
  await expect(sam.getByRole('link', { name: 'Pluie record sur Bruxelles' }).first()).toBeAttached()

  await sam.goto('/#/reglages/lecture')
  await sam.getByRole('radio', { name: 'Français' }).click()
  await expect(sam.getByRole('heading', { name: 'Lecture et affichage', level: 1 })).toBeVisible()
})

test('shows a teen only the sources its parents gave it', async ({ browser }) => {
  teen = await signIn(browser, 'Zoé')
  await skipTour(teen)
  await expect(teen.getByRole('button', { name: 'Zoé, ton profil' })).toBeVisible()
  await expect(teen.getByText('Pluie record sur Bruxelles').first()).toBeVisible()
  await expect(teen.getByText('Le nouveau tram arrive à Liège').first()).toBeVisible()
  // Beta Presse and Gamma are not its sources: not in its lists, and not in its search.
  await expect(teen.getByText('La bourse de Paris recule')).toHaveCount(0)
  await expect(teen.getByText('Le vélo gagne du terrain à Namur')).toHaveCount(0)
  await teen.goto('/#/recherche/bourse')
  await expect(teen.getByRole('region', { name: 'Recherche' }).getByText('La bourse de Paris recule')).toHaveCount(0)
})

test('a teen asks for two sources: a parent accepts one and refuses the other', async () => {
  for (const site of ['delta.example', 'epsilon.example']) {
    await teen.goto('/#/reglages/sources')
    await teen.getByRole('button', { name: 'Demander une source' }).click()
    const dialog = teen.getByRole('dialog', { name: 'Demander une source' })
    await dialog.getByRole('textbox', { name: 'Lien du site ou de la chaîne' }).fill(site)
    await dialog.getByRole('button', { name: 'Demander' }).click()
    await expect(dialog).toHaveCount(0)
  }
  await expect(teen.getByRole('heading', { name: 'Mes demandes 2' })).toBeVisible()

  await page.goto('/#/reglages')
  const pending = page.getByRole('region', { name: 'Demandes en attente' })
  const answer = async (name: string, choice: 'Accepter' | 'Refuser') => {
    await pending.getByRole('link', { name: new RegExp(`Zoé demande une source ${name}`) }).click()
    const dialog = page.getByRole('dialog', { name: 'Demande de source' })
    await expect(dialog).toContainText(name)
    await dialog.getByRole('button', { name: choice }).click()
    await expect(dialog).toHaveCount(0)
  }
  await answer('Delta', 'Accepter')
  await expect(page.getByText('Delta ajoutée pour Zoé')).toBeVisible()
  await answer('Epsilon', 'Refuser')
  await expect(page.getByText('Demande refusée')).toBeVisible()
  await expect(pending).toHaveCount(0)

  // For Zoé only: Delta's articles arrive in its fil, never Epsilon's, and nothing new for Alex.
  await teen.goto('/')
  await afterReload(teen, () =>
    expect(teen.getByRole('link', { name: 'Victoire des Diables rouges' }).first()).toBeVisible()
  )
  await expect(teen.getByText('Un nouveau jeu vidéo belge')).toHaveCount(0)
  await teen.goto('/#/reglages/sources')
  await expect(teen.getByRole('heading', { name: 'Mes demandes 0' })).toBeVisible()
  await expect(teen.getByRole('heading', { name: 'Ajoutées par tes parents 1' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByText('Victoire des Diables rouges')).toHaveCount(0)
})

test('closes the app for a teen outside the hours its parents set', async () => {
  // Hours that do not include now, whenever the tests run (Brussels time, as the household's).
  const [hour = 0, minute = 0] = new Intl.DateTimeFormat('fr-BE', {
    timeZone: 'Europe/Brussels',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
    .format(new Date())
    .split(':')
    .map(Number)
  const lateEvening = hour * 60 + minute < 22 * 60 + 30
  const [start, end] = lateEvening ? ['23', '23'] : ['01', '02']

  await page.goto('/#/reglages/profils')
  await page.getByRole('link', { name: 'Gérer Zoé' }).click()
  await page.getByRole('button', { name: 'Toute la journée' }).click()
  const dialog = page.getByRole('dialog', { name: 'Horaires' })
  await dialog.getByRole('switch', { name: 'Limiter les horaires' }).click()
  const type = async (name: string, value: string) => {
    await dialog.getByRole('spinbutton', { name }).click()
    await page.keyboard.type(value)
  }
  await type('heure, Début', start)
  await type('minute, Début', '00')
  await type('heure, Fin', end)
  await type('minute, Fin', '30')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('button', { name: `${start}:00 – ${end}:30` })).toBeVisible()

  await teen.goto('/')
  await expect(teen.getByRole('heading', { name: /^(À tout à l’heure|À demain), Zoé/ })).toBeVisible()
  // Before the hours: « à partir de 23:00 »; after them: « demain à 01:00 ».
  await expect(teen.getByText(new RegExp(`(à partir de|demain à) ${start}:00\\.`))).toBeVisible()
  await expect(teen.getByText('Pluie record sur Bruxelles')).toHaveCount(0)
})
