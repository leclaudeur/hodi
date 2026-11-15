// The pictures inside an article's text, numbered in their order. The reader asks the server for a smaller copy of
// picture n of article id, never by the picture's address: the server reads the address from the article it kept.

const IMAGE_TAG = /<img\b[^>]*>/gi
const SOURCE = /\ssrc=["']([^"']+)["']/i

// The address of every picture of the text, in order (null for a picture without one).
export const inlineImageSources = (html: string): (string | null)[] =>
  [...html.matchAll(IMAGE_TAG)].map(([tag]) => tag.match(SOURCE)?.[1]?.replaceAll('&amp;', '&') ?? null)

export interface ImageSize {
  width: number
  height: number
}

const SIZE_ATTRIBUTE = /\s(?:width|height)=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi

// The text with each picture marked with its number (data-image), for the reader to ask for its smaller copy. A
// picture the server already made carries its size, so the reader keeps its place before it loads and the text under
// it does not jump; the others keep the size their site gave, if any.
export const numberInlineImages = (html: string, sizes: (ImageSize | null)[] = []): string => {
  let index = 0
  return html.replace(IMAGE_TAG, tag => {
    const size = sizes[index]
    const marked = `<img data-image="${index++}"`
    return size
      ? tag.replace(SIZE_ATTRIBUTE, '').replace(/^<img\b/i, `${marked} width="${size.width}" height="${size.height}"`)
      : tag.replace(/^<img\b/i, marked)
  })
}
