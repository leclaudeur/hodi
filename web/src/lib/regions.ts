import { type Language, getLanguage } from './i18n.ts'

// The time zones and countries a household can pick, named by the browser in the interface's language.

// ISO 3166-1 alpha-2: every country the browser can name.
const COUNTRY_CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' '
  )

const countryNames = new Map<Language, Intl.DisplayNames>()

export const countryName = (code: string) => {
  const language = getLanguage()
  if (!countryNames.has(language)) countryNames.set(language, new Intl.DisplayNames([language], { type: 'region' }))
  return countryNames.get(language)!.of(code) ?? code
}

// In the interface's language, sorted its way.
export const countries = () => {
  const language = getLanguage()
  return COUNTRY_CODES.map(code => ({ code, name: countryName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name, language)
  )
}

// "Europe/Brussels" reads "Brussels", its offset beside it.
export const timeZoneCity = (timeZone: string) => (timeZone.split('/').pop() ?? timeZone).replaceAll('_', ' ')

export const timeZoneOffset = (timeZone: string, at = new Date()) =>
  new Intl.DateTimeFormat(getLanguage(), { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find(part => part.type === 'timeZoneName')?.value ?? ''

export const TIME_ZONES = Intl.supportedValuesOf('timeZone')

// This browser's, as the first-run screens' guess.
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

// The country of the browser's language (fr-BE → BE), when it names one.
export const deviceCountry = () => {
  for (const language of navigator.languages) {
    const region = new Intl.Locale(language).region
    if (region && COUNTRY_CODES.includes(region)) return region
  }
  return null
}
