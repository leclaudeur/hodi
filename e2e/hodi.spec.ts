import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test'
import { Secret, TOTP } from 'otpauth'
import { MAX_PROBING, probingWatch } from './probing.ts'

// What Hodi cannot do without, on a fresh install, one journey after the other: set it up, read, save, search, add
// profiles and sources, sign in on other devices, share between profiles, and keep a teen to what its parents chose.
// The news sites are e2e/server.ts's pages. Alex (admin) uses `page`, Sam (adult) `sam` and Zoé (teen) `teen`.

const EMAIL = 'alex@example.com'
const PASSWORD = 'un mot de passe solide 42'
// Sam's, once the admin's code has given a new one.
const SAM_PASSWORD = 'une toute nouvelle phrase 7'
const ZOE_PASSWORD = 'la phrase de Zoé 2026'
// Alex's own Code parental, asked for Alex's profile on a device where Zoé is signed in.
const PARENTAL_CODE = '482913'

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

// A proxy such as CrowdSec bans an address that gets many refusals on different paths: no journey may come near it.
const probing = probingWatch()

test.beforeAll(async ({ browser, baseURL }) => {
  probing.attach(browser, baseURL ?? '')
  page = await browser.newPage()
})

// Using the app is never refused: a GET answers, or 401 once signed out, never 400, 403 or 404. A refused click
// (a wrong password) is a single path, which the bucket holds well under a ban.
test.afterEach(() => {
  const { refusals, peak } = probing.take()
  expect(refusals.filter(refusal => refusal.method === 'GET')).toEqual([])
  expect(peak, JSON.stringify(refusals)).toBeLessThanOrEqual(MAX_PROBING)
})

test.afterAll(async () => {
  await Promise.all([page, sam, teen].filter(Boolean).map(open => open.close()))
})

// A new device: Alex's account opens Alex's profile; a young one is then picked in "Qui lit ?", and Sam adds his
// account there with « Ajouter ». A context instead of the browser: a device whose test opens more tabs.
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
  if (name === 'Alex') return device
  await device.goto('/#/profiles')
  if (name === 'Sam') {
    await device.getByRole('button', { name: 'Ajouter' }).click()
    await device.getByRole('textbox', { name: 'E-mail' }).fill('sam@example.com')
    await device.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(SAM_PASSWORD)
    await device.getByRole('button', { name: 'Se connecter' }).click()
    await expect(device.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()
  } else await device.getByRole('button', { name: new RegExp(name) }).click()
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

test('sets up the server in the browser', async () => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Installer Hodi' }).click()
  // The server admin's own account first, then its profile.
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
  // The server is set up: the admin's profile comes next, or later from the server's space. No household to name.
  await expect(page.getByRole('heading', { name: 'Le serveur est prêt' })).toBeVisible()
  await page.getByRole('button', { name: 'Créer mon profil' }).click()
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

// « Qui lit ? » at every opening: the app asks nothing before a profile is picked, so no request is refused.
test('opens the app again in a new tab without a refused request', async ({ browser }) => {
  const context = await browser.newContext()
  const first = await signIn(context, 'Alex')
  await first.close()
  for (let opening = 0; opening < 2; opening++) {
    const tab = await context.newPage()
    await tab.goto('/')
    await expect(tab.getByRole('heading', { name: 'Qui lit ?' })).toBeVisible()
    await tab.close()
  }
  await context.close()
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

test('invites someone from Serveur › Comptes, who joins with the code and makes their own account', async ({
  browser
}) => {
  await page.goto('/#/server/accounts')
  await page.getByRole('button', { name: 'Inviter quelqu’un' }).click()
  const invite = page.getByRole('dialog', { name: 'Inviter quelqu’un' })
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
  await expect(device.getByRole('heading', { name: 'Bienvenue sur Hodi' })).toBeVisible()
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
  // The code used, Sam's account is on the server.
  await page.reload()
  await expect(page.getByRole('link', { name: /sam@example\.com/ })).toBeVisible()
})

test('gives Sam, who forgot their password, a new one with a code from the server’s admin only', async ({
  browser
}) => {
  // Sam's device from before: the new password signs it out.
  const before = await browser.newPage()
  await before.goto('/')
  await before.getByRole('textbox', { name: 'E-mail' }).fill('sam@example.com')
  await before.getByRole('textbox', { name: 'Mot de passe' }).fill(PASSWORD)
  await before.getByRole('button', { name: 'Entrer' }).click()
  await expect(before.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()

  // Without a mail server, « Mot de passe oublié » asks the server's admin for the code.
  const device = await browser.newPage()
  await device.goto('/')
  await device.getByRole('link', { name: 'Mot de passe oublié' }).click()
  await device.getByRole('textbox', { name: 'E-mail' }).fill('sam@example.com')
  await device.getByRole('button', { name: 'Demander', exact: true }).click()
  await expect(device.getByRole('heading', { name: 'Entre le code' })).toBeVisible()
  await page.goto('/#/server/inbox')
  const request = page.getByRole('link', { name: /^Sam demande un code/ })
  await expect(request).toBeVisible()

  // Sam's password is Sam's: Mon compte › Mes enfants lists the young ones only, never another adult.
  await page.goto('/#/account/children')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Mes enfants', level: 1 })).toBeVisible()
  await expect(page.getByRole('main').getByText('Sam', { exact: true })).toHaveCount(0)

  // The server's admin opens the request, then makes the code: their own password first, and a wrong one stays in
  // the question.
  await page.goto('/#/server/inbox')
  await request.click()
  await page.getByRole('main').getByRole('link', { name: 'Ouvrir le compte' }).click()
  const askPassword = async (typed: string) => {
    await page.getByRole('main').getByRole('button', { name: 'Faire un code' }).first().click()
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
  const code = await reset.getByRole('textbox', { name: 'Code' }).inputValue()
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/)
  await reset.getByRole('button', { name: 'Terminé' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The code made, the request is handled, and Sam's account offers no other code until Sam asks again.
  await expect(page.getByRole('main').getByRole('button', { name: 'Faire un code' })).toHaveCount(0)
  await page.goto('/#/server/inbox')
  await request.click()
  await expect(page.getByRole('main').getByText(/^Traité le /)).toBeVisible()

  // Sam types it where the page waited, then the new password.
  await device.getByRole('textbox', { name: 'Code' }).fill(code)
  await device.getByRole('button', { name: 'Confirmer' }).click()
  await expect(device.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible()
  await device.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(SAM_PASSWORD)
  await device.getByRole('textbox', { name: 'Confirme le mot de passe' }).fill(SAM_PASSWORD)
  await device.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(device.getByRole('heading', { name: 'C’est fait' })).toBeVisible()
  await device.getByRole('button', { name: 'Entrer dans Hodi' }).click()
  await expect(device.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()
  await device.close()

  await before.reload()
  await expect(before.getByRole('textbox', { name: 'E-mail' })).toBeVisible()
  // Signed out, the round in the corner switches the language, on Connexion and on the screens of a code.
  await before.getByRole('button', { name: 'English' }).click()
  await expect(before.getByRole('button', { name: 'Enter' })).toBeVisible()
  await before.getByRole('link', { name: 'I have a code' }).click()
  await before.getByRole('button', { name: 'Français' }).click()
  await expect(before.getByRole('textbox', { name: 'Code' })).toBeVisible()
  await expect(before.getByRole('button', { name: 'English' })).toBeVisible()
  await before.close()
})

test('creates a teen’s account, which signs in with its username and the password its parent chose', async ({
  browser
}) => {
  await page.goto('/#/account/children')
  await page.getByRole('button', { name: 'Ajouter un enfant' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ajouter un enfant' })
  await dialog.getByRole('textbox', { name: 'Prénom' }).fill('Zoé')
  await dialog.getByRole('radio', { name: 'Ado' }).check()
  await expect(dialog.getByRole('textbox', { name: 'Identifiant' })).toHaveValue('zoe')
  await dialog.getByRole('button', { name: 'Continuer' }).click()
  const password = page.getByRole('dialog', { name: 'Le mot de passe de Zoé' })
  await password.getByLabel('Mot de passe', { exact: true }).fill(ZOE_PASSWORD)
  await password.getByLabel('Confirme le mot de passe').fill(ZOE_PASSWORD)
  await password.getByRole('button', { name: 'Créer' }).click()
  // Her card opens, with the password she signs in with.
  await expect(page.getByText('Se connecte avec @zoe')).toBeVisible()

  // In Mes enfants, where every young one is; the adults are accounts, not in this list.
  await page.goto('/#/account/children')
  await expect(page.getByRole('link', { name: 'Gérer Zoé' })).toHaveCount(1)

  // Her own phone: her username and her password, no e-mail.
  const phone = await browser.newPage()
  await phone.goto('/')
  await phone.getByRole('textbox', { name: 'E-mail' }).fill('@zoe')
  await phone.getByRole('textbox', { name: 'Mot de passe' }).fill(ZOE_PASSWORD)
  await phone.getByRole('button', { name: 'Entrer' }).click()
  // Her profile's first time in Hodi: its tour, once.
  await skipTour(phone)
  await expect(phone.getByRole('button', { name: 'Zoé, mon profil' })).toBeVisible()
  await phone.close()
})

test('signs Zoé’s own tablet in with her username, which opens her profile only, until a parent removes it', async ({
  browser
}) => {
  // Her tablet: her username and her password, as on her phone.
  const tablet = await browser.newPage()
  await tablet.goto('/')
  await tablet.getByRole('textbox', { name: 'E-mail' }).fill('@zoe')
  await tablet.getByRole('textbox', { name: 'Mot de passe' }).fill(ZOE_PASSWORD)
  await tablet.getByRole('button', { name: 'Entrer' }).click()
  // Her tour was taken on her phone: straight into her profile.
  await expect(tablet.getByRole('button', { name: 'Zoé, mon profil' })).toBeVisible()
  // No other profile to open from it: « Qui lit ? » lists her alone.
  await tablet.goto('/#/profiles')
  await expect(tablet.getByRole('button', { name: /Zoé/ })).toBeVisible()
  await expect(tablet.getByRole('button', { name: /Alex|Sam/ })).toHaveCount(0)

  // A parent removes it from her card: it asks to sign in again.
  await page.goto('/#/account/children')
  await page.getByRole('link', { name: 'Gérer Zoé' }).click()
  // She signed in on a phone too, in the test before: each device goes.
  const removes = page.getByRole('button', { name: /^Retirer / })
  await expect(removes).not.toHaveCount(0)
  for (let left = await removes.count(); left > 0; left -= 1) {
    await removes.first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Retirer' }).click()
    await expect(removes).toHaveCount(left - 1)
  }
  await tablet.reload()
  await expect(tablet.getByRole('textbox', { name: 'E-mail' })).toBeVisible()
  await tablet.close()
})

// « Qui lit ? »: a parent opens at once, or with their own Code parental where their teen is signed in too; Sam's
// private profile asks for Sam's password instead, except on a device Sam trusts; the teen never asks for anything.
test('opens a parent with their Code parental, and a private profile with its password unless trusted', async ({
  browser
}) => {
  // Sam makes the profile private, with the password it will ask for.
  const own = await browser.newPage()
  await own.goto('/')
  await own.getByRole('textbox', { name: 'E-mail' }).fill('sam@example.com')
  await own.getByRole('textbox', { name: 'Mot de passe' }).fill(SAM_PASSWORD)
  await own.getByRole('button', { name: 'Entrer' }).click()
  await expect(own.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()
  await own.goto('/#/account/sign-in')
  await own.getByRole('switch', { name: 'Profil privé' }).click()
  const question = own.getByRole('dialog', { name: 'Rendre ce profil privé ?' })
  await question.getByLabel('Mon mot de passe').fill(SAM_PASSWORD)
  await question.getByRole('button', { name: 'Rendre privé' }).click()
  await expect(own.getByRole('switch', { name: 'Profil privé' })).toHaveAttribute('aria-checked', 'true')

  // Alex, Zoé's parent, sets a Code parental in Mon compte › Mes enfants.
  await page.goto('/#/account/children')
  await expect(page.getByText('Conseillé, pas encore choisi')).toBeVisible()
  await page.getByRole('switch', { name: 'Code parental' }).click()
  const choose = page.getByRole('dialog', { name: 'Le code parental' })
  await choose.getByLabel('Nouveau code').fill(PARENTAL_CODE)
  await choose.getByRole('button', { name: 'Enregistrer' }).click()
  // Then Alex's own password: a profile left open does not prove who changes the code.
  const proof = page.getByRole('dialog', { name: 'Enregistrer ce code parental ?' })
  await proof.getByLabel('Mon mot de passe').fill(PASSWORD)
  await proof.getByLabel('Code de l’app d’authentification').fill(await appCode())
  await proof.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Oublié ? Le mot de passe du compte le remplace')).toBeVisible()

  // Alex's account on the family tablet: no young account signed in yet, Alex's profile opens at once.
  const device = await signIn(browser, 'Zoé')
  await expect(device.getByRole('button', { name: 'Zoé, mon profil' })).toBeVisible()
  await device.goto('/#/profiles')
  await device.getByRole('button', { name: /Alex/ }).click()
  await expect(device.getByRole('button', { name: 'Alex, mon profil' })).toBeVisible()
  // Zoé adds her own account: Alex's profile now asks for the code, its last digit opens it.
  await device.goto('/#/profiles')
  await device.getByRole('button', { name: 'Ajouter' }).click()
  await device.getByRole('textbox', { name: 'E-mail' }).fill('@zoe')
  await device.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(ZOE_PASSWORD)
  await device.getByRole('button', { name: 'Se connecter' }).click()
  await expect(device.getByRole('button', { name: 'Zoé, mon profil' })).toBeVisible()
  await device.goto('/#/profiles')
  await device.getByRole('button', { name: /Alex/ }).click()
  await device.getByLabel('Code parental').fill('000000')
  await expect(device.getByText('Ce code n’est pas le bon.')).toBeVisible()
  await device.getByLabel('Code parental').fill(PARENTAL_CODE)
  await expect(device.getByRole('button', { name: 'Alex, mon profil' })).toBeVisible()

  // Only the accounts signed in here show: Sam adds his with « Ajouter », which opens his profile.
  await device.goto('/#/profiles')
  await expect(device.getByRole('button', { name: /Sam/ })).toHaveCount(0)
  await device.getByRole('button', { name: 'Ajouter' }).click()
  await expect(device.getByRole('heading', { name: 'Ajouter mon compte' })).toBeVisible()
  await device.getByRole('textbox', { name: 'E-mail' }).fill('sam@example.com')
  await device.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(SAM_PASSWORD)
  await device.getByRole('button', { name: 'Se connecter' }).click()
  await expect(device.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()

  // Sam's private profile: the code is no way in, Sam's password is, and Sam trusts this device.
  await device.goto('/#/profiles')
  await device.getByRole('button', { name: /Zoé/ }).click()
  await expect(device.getByRole('button', { name: 'Zoé, mon profil' })).toBeVisible()
  await device.goto('/#/profiles')
  await device.getByRole('button', { name: /Sam/ }).click()
  await device.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(SAM_PASSWORD)
  await device.getByRole('checkbox', { name: 'Ne plus demander sur cet appareil' }).click()
  await device.getByRole('button', { name: 'Ouvrir' }).click()
  await expect(device.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()
  await device.goto('/#/profiles')
  await device.getByRole('button', { name: /Zoé/ }).click()
  await expect(device.getByRole('button', { name: 'Zoé, mon profil' })).toBeVisible()
  await device.goto('/#/profiles')
  await device.getByRole('button', { name: /Sam/ }).click()
  await expect(device.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()

  // « Redemander », from Sam's own device: the password again everywhere.
  await own.reload()
  await own.getByRole('button', { name: 'Redemander' }).click()
  await expect(own.getByText('Appareils de confiance')).toHaveCount(0)
  await device.goto('/#/profiles')
  await device.getByRole('button', { name: /Zoé/ }).click()
  await expect(device.getByRole('button', { name: 'Zoé, mon profil' })).toBeVisible()
  await device.goto('/#/profiles')
  await device.getByRole('button', { name: /Sam/ }).click()
  await expect(device.getByRole('textbox', { name: 'Mot de passe', exact: true })).toBeVisible()

  // A forgotten code: Alex's password opens Alex's profile instead.
  await device.getByRole('button', { name: 'Retour' }).click()
  await device.getByRole('button', { name: /Alex/ }).click()
  await device.getByRole('button', { name: 'Code oublié ? Le mot de passe du compte' }).click()
  await device.getByRole('textbox', { name: /mot de passe/i }).fill(PASSWORD)
  await device.getByRole('button', { name: 'Ouvrir' }).click()
  await expect(device.getByRole('button', { name: 'Alex, mon profil' })).toBeVisible()

  await own.close()
  await device.close()

  // No code any more, with Alex's password: Alex's profile opens at once again.
  await page.getByRole('switch', { name: 'Code parental' }).click()
  const off = page.getByRole('dialog', { name: 'Désactiver le code parental ?' })
  await off.getByLabel('Mon mot de passe').fill(PASSWORD)
  await off.getByLabel('Code de l’app d’authentification').fill(await appCode())
  await off.getByRole('button', { name: 'Désactiver' }).click()
  await expect(page.getByRole('switch', { name: 'Code parental' })).toHaveAttribute('aria-checked', 'false')
})

test('adds a source from the link of its site', async () => {
  await page.goto('/#/settings/sources')
  // The dashed card, first in Mes sources.
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Ajouter une source' })
    .getByRole('button', { name: 'Ajouter' })
    .click()
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
  await expect(page.getByRole('main').getByRole('heading', { level: 3, name: /Gamma/ })).toBeVisible()

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
  // Opened again with the profile closed: nothing asks for its data, which a closed profile refuses.
  await again.close()
  const third = await context.newPage()
  await third.goto('/')
  await expect(third.getByRole('heading', { name: 'Qui lit ?' })).toBeVisible()
  await context.close()
})

test('lists the account’s devices in Mon compte and signs one out', async ({ browser }) => {
  const other = await signIn(browser, 'Alex')
  await page.goto('/#/account/sign-in')
  // The list as it is now, with the device just signed in.
  await page.reload()
  const main = page.getByRole('main')
  await expect(main.getByText(EMAIL, { exact: true })).toBeVisible()
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

test('shows no household: nothing to leave, no Foyer in Réglages, no Foyers in Serveur', async () => {
  await page.goto('/#/account/data')
  await expect(page.getByRole('heading', { name: 'Données', level: 1 })).toBeVisible()
  await expect(page.getByRole('main').getByRole('button', { name: 'Quitter' })).toHaveCount(0)
  await page.goto('/#/settings')
  await expect(page.getByRole('link', { name: /^Général/ }).first()).toBeVisible()
  // The young ones are their parents' Mon compte › Mes enfants, not a Réglages entry.
  await expect(page.getByRole('link', { name: /Ados et enfants/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Foyer/ })).toHaveCount(0)
  // The old addresses open where their settings went: Serveur › Général, Serveur › Comptes.
  await page.goto('/#/settings/household')
  await expect(page.getByRole('heading', { name: 'Général' }).first()).toBeVisible()
  await page.goto('/#/server/households')
  await expect(page.getByRole('button', { name: 'Inviter quelqu’un' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Foyers/ })).toHaveCount(0)
})

test('reads on a phone', async ({ browser }) => {
  const phone = await signIn(browser, 'Alex', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await phone.getByRole('link', { name: 'La bourse de Paris recule' }).first().click()
  await expect(phone.getByText('La bourse de Paris recule, paragraphe 8.', { exact: false })).toBeVisible()
  await phone.close()
})

test('shares an article with and without a word, and the sender sees the reactions', async ({ browser }) => {
  // Sam is not signed in here and has no family tie with Alex: found by his username the first time, then offered.
  const send = async (word: string, title: string, note: string) => {
    await openFromSearch(page, word, title)
    await page.getByRole('button', { name: 'Envoyer à quelqu’un' }).click()
    const dialog = page.getByRole('dialog', { name: 'Envoyer à…' })
    const person = dialog.getByRole('checkbox', { name: 'Sam' })
    if (!note) await expect(person).toBeVisible()
    else {
      await expect(person).toHaveCount(0)
      await dialog.getByRole('textbox', { name: 'Son identifiant' }).fill('@personne')
      await dialog.getByRole('button', { name: 'Ajouter' }).click()
      await expect(dialog.getByText('Ce compte n’existe pas.')).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Son identifiant' }).fill('@sam')
      await dialog.getByRole('button', { name: 'Ajouter' }).click()
    }
    await person.check()
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

test('adds another account to « Qui lit ? » with its password, then signs each one out', async ({ browser }) => {
  const other = await signIn(browser, 'Alex')
  await other.goto('/#/profiles')
  await expect(other.getByRole('button', { name: /Sam/ })).toHaveCount(0)
  await other.getByRole('button', { name: 'Ajouter' }).click()
  await other.getByRole('textbox', { name: 'E-mail' }).fill('sam@example.com')
  await other.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(PASSWORD)
  await other.getByRole('button', { name: 'Se connecter' }).click()
  await expect(other.getByText('E-mail ou mot de passe incorrect, réessaie.')).toBeVisible()
  await other.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(SAM_PASSWORD)
  await other.getByRole('button', { name: 'Se connecter' }).click()
  await expect(other.getByRole('button', { name: 'Sam, mon profil' })).toBeVisible()

  // An address from before the routes were in English still opens, under its English name.
  await other.goto('/#/reglages/compte')
  await expect(other).toHaveURL(/#\/settings\/account$/)
  // Sam signs out of this device: Alex and Zoé stay in « Qui lit ? ».
  await other.goto('/#/settings')
  await other.getByRole('button', { name: 'Se déconnecter' }).click()
  const out = other.getByRole('dialog', { name: 'Se déconnecter de cet appareil ?' })
  await expect(out).toContainText('Alex et Zoé restent ici')
  await out.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(other.getByRole('heading', { name: 'Qui lit ?' })).toBeVisible()
  await expect(other.getByRole('button', { name: /Sam/ })).toHaveCount(0)

  // Alex, the last adult here: Zoé leaves with him, and the device goes back to Connexion.
  await other.getByRole('button', { name: /Alex/ }).click()
  await expect(other.getByRole('button', { name: 'Alex, mon profil' })).toBeVisible()
  await other.goto('/#/settings')
  await other.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(out).toContainText('Zoé quitte aussi')
  await out.getByRole('button', { name: 'Se déconnecter' }).click()
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
  // The language is the account's, in Mon compte › Profil beside the name and the photo.
  await sam.goto('/#/account/profile')
  await sam.getByRole('radio', { name: 'English' }).click()
  await expect(sam.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()
  await expect(sam.getByRole('link', { name: 'Back' })).toBeVisible()
  // The articles keep their own language.
  await sam.goto('/')
  await expect(sam.getByRole('link', { name: 'Settings' }).first()).toBeVisible()
  await expect(sam.getByRole('link', { name: 'Pluie record sur Bruxelles' }).first()).toBeAttached()

  await sam.goto('/#/account/profile')
  await sam.getByRole('radio', { name: 'Français' }).click()
  await expect(sam.getByRole('heading', { name: 'Profil', level: 1 })).toBeVisible()
})

test('makes Sam Zoé’s second parent: Alex invites Sam’s username, Sam accepts', async () => {
  await page.goto('/#/account/children')
  await page.getByRole('link', { name: 'Gérer Zoé' }).click()
  await page.getByRole('button', { name: 'Inviter un second parent' }).click()
  const invite = page.getByRole('dialog', { name: 'Inviter un parent' })
  await invite.getByRole('textbox', { name: 'Identifiant' }).fill('personne')
  await invite.getByRole('button', { name: 'Inviter' }).click()
  await expect(invite.getByText('Ce compte n’existe pas.')).toBeVisible()
  await invite.getByRole('textbox', { name: 'Identifiant' }).fill('sam')
  await invite.getByRole('button', { name: 'Inviter' }).click()
  await expect(page.getByText('@sam · Invitation envoyée, en attente de réponse')).toBeVisible()

  await sam.goto('/#/account/children')
  await sam.getByRole('button', { name: 'Accepter d’être parent de Zoé' }).click()
  await expect(sam.getByRole('link', { name: 'Gérer Zoé' })).toBeVisible()
  await page.reload()
  await expect(page.getByText(/^@sam · parent depuis le /)).toBeVisible()
  // Out of Réglages: it lists the teen's requests again when it opens next.
  await page.goto('/')
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
    await teen.getByRole('button', { name: 'Demander', exact: true }).click()
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
  // Nothing left waiting: no requests' grid.
  await expect(teen.getByRole('heading', { name: /^Mes demandes/ })).toHaveCount(0)
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

  await page.goto('/#/account/children')
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
