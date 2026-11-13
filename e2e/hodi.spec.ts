import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test'
import { Secret, TOTP } from 'otpauth'

// What Hodi cannot do without, on a fresh install, one journey after the other: set it up, read, save, search, add
// profiles and sources, sign in on other devices, share between profiles, and keep a teen to what its parents chose.
// The news sites are e2e/server.ts's pages. Alex (admin) uses `page`, Sam (adult) `sam` and Zoé (teen) `teen`.

const EMAIL = 'alex@example.com'
const PASSWORD = 'un mot de passe solide 42'
// Sam's, once the admin's code has given a new one.
const SAM_PASSWORD = 'une toute nouvelle phrase 7'

// Longer than Playwright's 30 s: a sign-in may wait for the app's next code (see appCode).
test.describe.configure({ mode: 'serial', timeout: 120_000 })

// Alex runs the server, so the setup turns « Validation en deux étapes » on: this is the authenticator app.
let secret = ''
let lastStep = 0
// The app's code for the 30-second step now, or the next one: each works once, so a step already used waits.
const appCode = async () => {
  for (;;) {
    const now = Math.floor(Date.now() / 30_000)
    const step = [now, now + 1].find(candidate => candidate > lastStep)
    if (step !== undefined) {
      lastStep = step
      return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({
        timestamp: step * 30_000
      })
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

let page: Page
let sam: Page
let teen: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
})

test.afterAll(async () => {
  await Promise.all([page, sam, teen].filter(Boolean).map(open => open.close()))
})

// A new device: Alex's account opens Alex's profile; another profile is then picked in "Qui lit ?", with its
// account's password when it has one (Sam's). A context instead of the browser: a device whose test opens more tabs.
const signIn = async (
  browser: Browser | BrowserContext,
  name: string,
  options: Parameters<Browser['newPage']>[0] = {}
) => {
  const device = 'newContext' in browser ? await browser.newPage(options) : await browser.newPage()
  await device.goto('/')
  await device.getByRole('textbox', { name: 'E-mail' }).fill(EMAIL)
  await device.getByRole('textbox', { name: 'Mot de passe' }).fill(PASSWORD)
  await device.getByRole('button', { name: 'Entrer' }).click()
  await device.getByLabel('Code', { exact: true }).fill(await appCode())
  // Signed in only once the app shows: a test that reads this device's session from another one must not race it.
  await expect(device.getByRole('link', { name: 'Réglages' }).first()).toBeVisible()
  if (name !== 'Alex') {
    await device.goto('/#/profiles')
    await device.getByRole('button', { name: new RegExp(name) }).click()
    if (name === 'Sam') {
      await device.getByRole('textbox', { name: 'Mot de passe de Sam' }).fill(SAM_PASSWORD)
      await device.getByRole('button', { name: 'Ouvrir' }).click()
    }
  }
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
  await device.goto(`/#/search/${word}`)
  await device.getByRole('region', { name: 'Recherche' }).getByRole('link', { name: title }).click()
}

test('sets up the household in the browser', async () => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Installer Hodi' }).click()
  // The server admin's own account first, then the household, which has no password of its own.
  await page.getByRole('textbox', { name: 'E-mail' }).fill(EMAIL)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirme le mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Continuer' }).click()
  // The server's account always asks for its app's code too: the key under the QR goes in the app.
  await expect(page.getByRole('heading', { name: 'Protège le compte' })).toBeVisible()
  // The key shows once the server made it.
  await expect(page.getByRole('code')).toHaveText(/[A-Z2-7]{4}/)
  secret = (await page.getByRole('code').innerText()).replace(/\s/g, '')
  await page.getByLabel('Code de l’app').fill(await appCode())
  await expect(page.getByRole('heading', { name: 'Garde les codes de secours' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Codes de secours' }).getByRole('listitem')).toHaveCount(10)
  const keep = page.getByRole('button', { name: 'Continuer' })
  await expect(keep).toBeDisabled()
  await page.getByRole('button', { name: 'Télécharger' }).click()
  await keep.click()
  // The server is set up: its household comes next, or later from the server's space.
  await expect(page.getByRole('heading', { name: 'Le serveur est prêt' })).toBeVisible()
  await page.getByRole('button', { name: 'Créer mon foyer' }).click()
  await page.getByRole('textbox', { name: 'Nom du foyer' }).fill('Famille Test')
  await page.getByRole('button', { name: 'Continuer' }).click()
  await page.getByPlaceholder('Ex. Léa').fill('Alex')
  await page.getByRole('button', { name: 'Continuer' }).click()
  // Never a real AI key in a test.
  await page.getByRole('radio', { name: /Sans IA/ }).check()
  await page.getByRole('button', { name: 'Continuer' }).click()
  await expect(page.getByText(`${EMAIL} · admin du serveur`)).toBeVisible()
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
  await page.goto('/#/search/liege')
  const results = page.getByRole('region', { name: 'Recherche' })
  await expect(results.getByText('Le nouveau tram arrive à Liège').first()).toBeVisible()
  await expect(results.getByText('La bourse de Paris recule')).toHaveCount(0)
})

test('invites an adult, who joins with the code and makes their own account', async ({ browser }) => {
  await page.goto('/#/settings/profiles')
  await page.getByRole('button', { name: 'Inviter un adulte' }).click()
  const invite = page.getByRole('dialog', { name: 'Inviter un adulte' })
  await expect(invite.getByRole('img', { name: 'QR du lien d’invitation' })).toBeVisible()
  const code = await invite.getByRole('textbox', { name: 'Code' }).inputValue()
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/)
  await invite.getByRole('button', { name: 'Terminé' }).click()

  // Sam's own device: « J'ai un code » on the Connexion page, then Sam's account and profile.
  const device = await browser.newPage()
  await device.goto('/')
  await device.getByRole('link', { name: 'J’ai un code' }).click()
  await device.getByRole('textbox', { name: 'Code' }).fill('ZZZZ2222')
  await expect(device.getByText('Ce code ne marche pas')).toBeVisible()
  await device.getByRole('textbox', { name: 'Code' }).fill(code)
  await expect(device.getByRole('heading', { name: 'Rejoins Famille Test' })).toBeVisible()
  await expect(device.getByText('Alex t’invite.')).toBeVisible()
  await device.getByRole('textbox', { name: 'E-mail' }).fill('sam@example.com')
  await device.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(PASSWORD)
  await device.getByRole('textbox', { name: 'Confirme le mot de passe' }).fill(PASSWORD)
  const next = device.getByRole('button', { name: 'Continuer' })
  await expect(next).toBeDisabled()
  await device.getByRole('checkbox', { name: 'J’ai au moins 13 ans' }).click()
  await next.click()
  await device.getByRole('textbox', { name: 'Prénom' }).fill('Sam')
  await device.getByRole('button', { name: 'Créer mon compte' }).click()
  // In, on Sam's own profile, which starts with its tour.
  await skipTour(device)
  await expect(device.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()
  await device.close()
})

test('gives Sam, who forgot their password, a new one with a code from the admin', async ({ browser }) => {
  // Sam's device from before: the new password signs it out.
  const before = await browser.newPage()
  await before.goto('/')
  await before.getByRole('textbox', { name: 'E-mail' }).fill('sam@example.com')
  await before.getByRole('textbox', { name: 'Mot de passe' }).fill(PASSWORD)
  await before.getByRole('button', { name: 'Entrer' }).click()
  await expect(before.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()

  // Sam joined from another device: the list as it is now.
  await page.goto('/#/settings/profiles')
  await page.reload()
  await page.getByRole('button', { name: 'Modifier Sam' }).click()
  // The code opens Sam's account: the admin's own password first, and a wrong one stays in the question.
  const askPassword = async (typed: string) => {
    await page.getByRole('button', { name: 'Nouveau mot de passe' }).click()
    const question = page.getByRole('dialog', { name: /^Nouveau mot de passe\s\?$/ })
    await question.getByLabel('Mon mot de passe').fill(typed)
    // The password is checked first: a wrong one never reaches the code.
    await question.getByLabel('Code de l’app d’authentification').fill(typed === PASSWORD ? await appCode() : '000000')
    await question.getByRole('button', { name: 'Créer le code' }).click()
    return question
  }
  const wrong = await askPassword('pas le bon mot de passe')
  await expect(wrong.getByText('Ce mot de passe n’est pas le bon.')).toBeVisible()
  await wrong.getByLabel('Mon mot de passe').fill(PASSWORD)
  await wrong.getByLabel('Code de l’app d’authentification').fill(await appCode())
  await wrong.getByRole('button', { name: 'Créer le code' }).click()
  const reset = page.getByRole('dialog', { name: 'Nouveau mot de passe', exact: true })
  await expect(reset.getByRole('img', { name: 'QR du lien d’invitation' })).toBeVisible()
  const first = await reset.getByRole('textbox', { name: 'Code' }).inputValue()
  expect(first).toMatch(/^[A-HJKMNP-Z2-9]{8}$/)
  // The same card, over the profile's: Retour goes back to it, Terminé closes both.
  await reset.getByRole('button', { name: 'Retour' }).click()
  await expect(page.getByRole('dialog', { name: 'Modifier le profil' })).toBeVisible()
  await askPassword(PASSWORD)
  await expect(reset.getByRole('img', { name: 'QR du lien d’invitation' })).toBeVisible()
  const code = await reset.getByRole('textbox', { name: 'Code' }).inputValue()
  await reset.getByRole('button', { name: 'Terminé' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // No « Mot de passe oublié » on the Connexion page without a mail server: « J'ai un code », then the new one.
  const device = await browser.newPage()
  await device.goto('/')
  await expect(device.getByText('Mot de passe oublié')).toHaveCount(0)
  await device.getByRole('link', { name: 'J’ai un code' }).click()
  await device.getByRole('textbox', { name: 'Code' }).fill(code)
  await expect(device.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible()
  await device.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(SAM_PASSWORD)
  await device.getByRole('textbox', { name: 'Confirme le mot de passe' }).fill(SAM_PASSWORD)
  await device.getByRole('button', { name: 'Valider' }).click()
  await expect(device.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()
  await device.close()

  await before.reload()
  await expect(before.getByRole('textbox', { name: 'E-mail' })).toBeVisible()
  await before.close()
})

test('creates a teen profile', async () => {
  await page.goto('/#/settings/profiles')
  // Sam joined from another device: the list shows it once loaded again.
  await page.reload()
  const dialog = page.getByRole('dialog', { name: 'Nouveau profil' })
  await page.getByRole('button', { name: 'Ajouter un profil' }).click()
  await dialog.getByRole('textbox', { name: 'Prénom' }).fill('Zoé')
  await dialog.getByRole('radio', { name: 'Ado' }).check()
  await dialog.getByRole('button', { name: 'Créer le profil' }).click()
  await expect(dialog).toHaveCount(0)

  const profiles = page.getByRole('main').getByRole('listitem')
  await expect(profiles.filter({ hasText: 'Sam' })).toContainText('Adulte')
  await expect(profiles.filter({ hasText: 'Zoé' })).toContainText('Ado')
})

test('links Zoé’s own tablet with a parent’s code, which opens her profile only, until it is removed', async ({
  browser
}) => {
  await page.goto('/#/settings/profiles')
  await page.getByRole('link', { name: 'Gérer Zoé' }).click()
  await page.getByRole('button', { name: 'Connecter un appareil' }).click()
  const connect = page.getByRole('dialog', { name: 'Connecter Zoé' })
  await expect(connect.getByRole('img', { name: 'QR du lien d’invitation' })).toBeVisible()
  const code = await connect.getByRole('textbox', { name: 'Code' }).inputValue()
  await connect.getByRole('button', { name: 'Terminé' }).click()

  // Her tablet: « J'ai un code », then this device is hers, with no e-mail or password.
  const tablet = await browser.newPage()
  await tablet.goto('/')
  await tablet.getByRole('link', { name: 'J’ai un code' }).click()
  await tablet.getByRole('textbox', { name: 'Code' }).fill(code)
  await expect(tablet.getByRole('heading', { name: 'Relier cet appareil' })).toBeVisible()
  await tablet.getByRole('button', { name: 'Valider' }).click()
  // Her profile's first time in Hodi: its tour, once.
  await skipTour(tablet)
  await expect(tablet.getByRole('button', { name: 'Zoé, mon profil' })).toBeVisible()
  // No other profile to open from it.
  await tablet.goto('/#/profiles')
  await expect(tablet.getByRole('heading', { name: 'Qui lit ?' })).toHaveCount(0)

  // A parent removes it: it asks for a code again.
  await page.reload()
  await page.getByRole('button', { name: /^Retirer / }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Retirer' }).click()
  await expect(page.getByRole('button', { name: /^Retirer / })).toHaveCount(0)
  await tablet.reload()
  await expect(tablet.getByRole('link', { name: 'J’ai un code' })).toBeVisible()
  await tablet.close()
})

test('asks every adult for its own password, on its own device too, never the teen', async ({ browser }) => {
  // Alex's own device: Zoé opens at once, Alex's profile then asks for Alex's password.
  const device = await signIn(browser, 'Zoé')
  await expect(device.getByRole('button', { name: 'Zoé, mon profil' })).toBeVisible()
  await device.goto('/#/profiles')
  await device.getByRole('button', { name: /Alex/ }).click()
  await device.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(PASSWORD)
  await device.getByRole('button', { name: 'Ouvrir' }).click()
  await expect(device.getByRole('button', { name: 'Alex, mon profil' })).toBeVisible()
  await device.close()
})

test('adds a source from the link of its site', async () => {
  await page.goto('/#/settings/sources')
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

test('signs in from another device, straight into its own profile', async ({ browser }) => {
  const other = await signIn(browser, 'Alex')
  await expect(other.getByRole('link', { name: 'La bourse de Paris recule' })).toBeVisible()
  // What the profile did on the first device follows it: its saved article.
  await expect(other.getByRole('link', { name: 'Enregistrés 1' })).toBeVisible()
  await other.close()
})

test('opens a second tab on the same profile, and « Qui lit ? » again once every tab is closed', async ({
  browser
}) => {
  const context = await browser.newContext()
  const first = await signIn(context, 'Alex')
  // Each opening starts on « Qui lit ? », but not while another tab shares this browser's profile.
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByRole('button', { name: 'Alex, mon profil' })).toBeVisible()
  await first.goto('/#/saved')
  await expect(first.getByRole('button', { name: 'Alex, mon profil' })).toBeVisible()
  await expect(first.getByRole('heading', { name: 'Qui lit ?' })).toHaveCount(0)

  // Every tab closed, the next opening asks again, and nothing shows behind « Qui lit ? ».
  await second.close()
  await first.close()
  const again = await context.newPage()
  await again.goto('/')
  await expect(again.getByRole('heading', { name: 'Qui lit ?' })).toBeVisible()
  await context.close()
})

test('lists the account’s devices in Compte et données and signs one out', async ({ browser }) => {
  const other = await signIn(browser, 'Alex')
  await page.goto('/#/settings/account')
  // The list as it is now, with the device just signed in.
  await page.reload()
  const main = page.getByRole('main')
  await expect(main.getByText(EMAIL)).toBeVisible()
  await expect(main.getByText('Cet appareil')).toBeVisible()
  // The most recently used first, after this one: the device just signed in.
  await main
    .getByRole('button', { name: /^Déconnecter / })
    .first()
    .click()
  await page.getByRole('dialog').getByRole('button', { name: 'Déconnecter' }).click()
  await expect(page.getByText(/déconnecté$/)).toBeVisible()
  await other.reload()
  await expect(other.getByRole('textbox', { name: 'E-mail' })).toBeVisible()
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
  const reactions = page.getByRole('region', { name: 'Réactions aux partages' })
  await expect(reactions.getByRole('link', { name: /Sam a réagi ❤️ La bourse de Paris recule/ })).toBeVisible()
  await expect(reactions.getByRole('link', { name: /Sam a réagi 👍 Le nouveau tram arrive à Liège/ })).toBeVisible()
})

test('opens another account’s profile only with its password, then signs out', async ({ browser }) => {
  const other = await signIn(browser, 'Alex')
  await other.goto('/#/profiles')
  await other.getByRole('button', { name: /Sam/ }).click()
  await other.getByRole('textbox', { name: 'Mot de passe de Sam' }).fill(PASSWORD)
  await other.getByRole('button', { name: 'Ouvrir' }).click()
  await expect(other.getByText('Ce mot de passe n’est pas le bon.')).toBeVisible()
  await other.getByRole('textbox', { name: 'Mot de passe de Sam' }).fill(SAM_PASSWORD)
  await other.getByRole('button', { name: 'Ouvrir' }).click()
  await expect(other.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()

  // An address from before the routes were in English still opens, under its English name.
  await other.goto('/#/reglages/compte')
  await expect(other).toHaveURL(/#\/settings\/account$/)
  await other.goto('/#/settings')
  await other.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(other.getByRole('textbox', { name: 'Mot de passe' })).toBeVisible()
  // Signed out for good: the app does not open again without the password.
  await other.goto('/#/saved')
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
  await sam.goto('/#/search/bruxelles')
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
  await sam.goto('/#/settings/reading')
  await sam.getByRole('radio', { name: 'English' }).click()
  await expect(sam.getByRole('heading', { name: 'Reading and display', level: 1 })).toBeVisible()
  await expect(sam.getByRole('link', { name: 'Settings' }).first()).toBeVisible()
  // The articles keep their own language.
  await sam.getByRole('link', { name: 'Feed' }).first().click()
  await expect(sam.getByRole('link', { name: 'Pluie record sur Bruxelles' }).first()).toBeAttached()

  await sam.goto('/#/settings/reading')
  await sam.getByRole('radio', { name: 'Français' }).click()
  await expect(sam.getByRole('heading', { name: 'Lecture et affichage', level: 1 })).toBeVisible()
})

test('shows a teen only the sources its parents gave it', async ({ browser }) => {
  // Her tour was skipped on her tablet: it does not come back here.
  teen = await signIn(browser, 'Zoé')
  await expect(teen.getByRole('button', { name: 'Zoé, mon profil' })).toBeVisible()
  await expect(teen.getByText('Pluie record sur Bruxelles').first()).toBeVisible()
  await expect(teen.getByText('Le nouveau tram arrive à Liège').first()).toBeVisible()
  // Beta Presse and Gamma are not its sources: not in its lists, and not in its search.
  await expect(teen.getByText('La bourse de Paris recule')).toHaveCount(0)
  await expect(teen.getByText('Le vélo gagne du terrain à Namur')).toHaveCount(0)
  await teen.goto('/#/search/bourse')
  await expect(teen.getByRole('region', { name: 'Recherche' }).getByText('La bourse de Paris recule')).toHaveCount(0)
})

test('a teen asks for two sources: a parent accepts one and refuses the other', async () => {
  for (const site of ['delta.example', 'epsilon.example']) {
    await teen.goto('/#/settings/sources')
    await teen.getByRole('button', { name: 'Demander une source' }).click()
    const dialog = teen.getByRole('dialog', { name: 'Demander une source' })
    await dialog.getByRole('textbox', { name: 'Lien du site ou de la chaîne' }).fill(site)
    await dialog.getByRole('button', { name: 'Demander' }).click()
    await expect(dialog).toHaveCount(0)
  }
  await expect(teen.getByRole('heading', { name: 'Mes demandes 2' })).toBeVisible()

  await page.goto('/#/settings')
  const pending = page.getByRole('region', { name: 'Demandes en attente' })
  const answer = async (name: string, choice: 'Accepter' | 'Refuser') => {
    await pending.getByRole('link', { name: new RegExp(`Zoé demande une source ${name}`) }).click()
    await expect(page).toHaveURL(/#\/settings\/requests\/\d+$/)
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
  await teen.goto('/#/settings/sources')
  await expect(teen.getByRole('heading', { name: 'Mes demandes 0' })).toBeVisible()
  await expect(teen.getByRole('heading', { name: 'Ajoutées par les parents 1' })).toBeVisible()
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

  await page.goto('/#/settings/profiles')
  await page.getByRole('link', { name: 'Gérer Zoé' }).click()
  // The settings row shows the hours under its title and opens them with « Changer »: the innermost div holding both.
  const hoursRow = page
    .locator('div')
    .filter({ has: page.getByText('Horaires', { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Changer' }) })
    .last()
  await expect(hoursRow.getByText('Toute la journée')).toBeVisible()
  await hoursRow.getByRole('button', { name: 'Changer' }).click()
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
  await expect(hoursRow.getByText(`${start}:00 – ${end}:30`)).toBeVisible()

  await teen.goto('/')
  await expect(teen.getByRole('heading', { name: /^(À tout à l’heure|À demain), Zoé/ })).toBeVisible()
  // Before the hours: « à partir de 23:00 »; after them: « demain à 01:00 ».
  await expect(teen.getByText(new RegExp(`(à partir de|demain à) ${start}:00\\.`))).toBeVisible()
  await expect(teen.getByText('Pluie record sur Bruxelles')).toHaveCount(0)
})
