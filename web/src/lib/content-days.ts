// How long an article stays in the lists and a video in Vidéos (Serveur › Contenu), and how many nightly copies the
// server keeps (Serveur › Sauvegardes): the session says, the pages that explain them read it.
interface ContentDays {
  articleDays: number
  videoDays: number
  backupCopies: number
}

let content: ContentDays = { articleDays: 3, videoDays: 60, backupCopies: 7 }

export const setContentDays = (next: ContentDays) => {
  content = next
}

export const contentDays = () => content
