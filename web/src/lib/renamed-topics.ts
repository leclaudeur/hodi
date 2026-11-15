// The topics' ids were French before they became English. A device or an address from before still carries them:
// each old id, to its new one. Server data was moved by a migration (server/db/migrations.ts).
export const RENAMED_TOPICS: ReadonlyMap<string, string> = new Map([
  ['belgique', 'belgium'],
  ['monde', 'world'],
  ['films-series', 'film-tv'],
  ['jeux-video', 'gaming'],
  ['ia', 'ai'],
  ['auto-moto', 'motoring'],
  ['argent-conso', 'money'],
  ['sante', 'health'],
  ['cuisine', 'food'],
  ['voyage', 'travel'],
  ['musique', 'music'],
  ['maison-deco', 'home'],
  ['famille', 'family'],
  ['mode-beaute', 'fashion'],
  ['climat', 'climate'],
  ['animaux', 'animals'],
  ['divers', 'other']
])

export const currentTopicId = (id: string) => RENAMED_TOPICS.get(id) ?? id
