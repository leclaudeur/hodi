import { extractArticle } from './extract.ts'

// The extraction thread's one task (extract-pool.ts).
export default ({ html, url }: { html: string; url: string }) => extractArticle(html, url)
