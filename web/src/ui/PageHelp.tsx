import { Trans, useTranslation } from 'react-i18next'

// A page's explanation, in the HelpButton beside its title: one text on a computer, another on a phone or a tablet,
// one paragraph per entry of help.<page>.<layout>.
export type HelpPage = 'feed' | 'followed' | 'shares' | 'videos'

const PageHelp = ({ page, layout }: { page: HelpPage; layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const paragraphs = t(`help.${page}.${layout}`, { returnObjects: true })
  // Trans only marks the <b> in the text already translated: array items have no typed key of their own.
  return paragraphs.map((text, index) => (
    <p key={index}>
      <Trans defaults={text} components={{ b: <b /> }} />
    </p>
  ))
}

export default PageHelp
