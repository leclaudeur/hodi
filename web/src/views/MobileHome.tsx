import { ArrowRight } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import PageHelp from '../ui/PageHelp.tsx'
import HelpButton from '../ui/HelpButton.tsx'
import type { SearchItem, TopicItem, TopicSummary } from '../api.ts'
import { useResume } from '../lib/resume.ts'
import { useDayFeed } from '../lib/day-feed.ts'
import { useReadableOffline } from '../lib/offline.ts'
import { todayLabel } from '../lib/format.ts'
import { useFrontPage, useFrontPageSettled } from '../lib/front-page.ts'
import { useIsTabletAcross } from '../lib/use-media.ts'
import { isHidden, usePreferences } from '../lib/preferences.ts'
import { usePullRefresh } from '../lib/pull-to-refresh.ts'
import { isRead, markRead, useReadState } from '../lib/read-state.ts'
import { rememberList } from '../lib/reading-list.ts'
import { topicHref } from '../lib/use-hash-route.ts'
import ArticleCard from '../ui/ArticleCard.tsx'
import Logo from '../ui/Logo.tsx'
import PhoneHeader from '../ui/PhoneHeader.tsx'
import ProfileButton from '../ui/ProfileButton.tsx'
import PullIndicator from '../ui/PullIndicator.tsx'
import { Bar, SlideSkeleton } from '../ui/Skeleton.tsx'
import TopicIcon from '../ui/TopicIcon.tsx'
import MobileFilterRow from './MobileFilterRow.tsx'
import styles from './MobileHome.module.css'
import { FeedEmpty, PhoneFeedFailed } from './FeedStates.tsx'
import ResumePile from './ResumePile.tsx'
import StoriesRow from './StoriesRow.tsx'
import { useFeedView } from './use-feed-view.ts'

// Cards per topic slider; "TOUT · N" opens the rest.
const SLIDER_SIZE = 8

// How far each topic's slider was slid: back from an article, it is where it was left.
const slid = new Map<string, number>()

// The first two sliders are on screen when the page opens: their first picture is the one the eye waits for.
const PRIORITY_SLIDERS = 2

const TopicSlider = ({ topic, items, first }: { topic: TopicSummary; items: SearchItem[]; first: boolean }) => {
  const { t } = useTranslation()
  const shown = items.slice(0, SLIDER_SIZE)
  const slider = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (slider.current) slider.current.scrollLeft = slid.get(topic.id) ?? 0
  }, [topic.id])
  const open = (item: TopicItem) => {
    markRead(item.id)
    rememberList(items)
  }

  return (
    <section className={styles.section} data-topic={topic.id} aria-label={topic.label}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>
          <TopicIcon topicId={topic.id} size={14} />
          {topic.label}
        </h2>
        <a
          className={styles.all}
          href={topicHref(topic.id)}
          aria-label={t('feed.allOf', { topic: topic.label, count: items.length })}
        >
          {t('feed.all')} · {items.length}
          <ArrowRight size={12} aria-hidden="true" />
        </a>
      </div>
      <div
        ref={slider}
        className={`${styles.slider} no-scrollbar`}
        onScroll={event => slid.set(topic.id, event.currentTarget.scrollLeft)}
      >
        {shown.map((item, index) => (
          <ArticleCard
            key={item.id}
            item={item}
            variant="slide"
            read={isRead(item.id)}
            onOpen={open}
            priority={first && index === 0}
          />
        ))}
      </div>
    </section>
  )
}

// A topic, while today's articles come.
const SlidersSkeleton = () => (
  <div aria-hidden="true">
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <Bar width={90} height={12} />
        <Bar width={64} height={28} radius={14} />
      </div>
      <div className={styles.slider}>
        <SlideSkeleton />
        <SlideSkeleton />
      </div>
    </section>
  </div>
)

const HomeSkeleton = () => (
  <div aria-hidden="true">
    <div className={styles.storiesSkeleton}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={styles.storySkeleton}>
          <Bar width={62} height={62} radius={31} />
          <Bar width={44} height={10} radius={5} />
        </span>
      ))}
    </div>
    <div className={styles.filtersSkeleton}>
      {[64, 104, 88, 80].map(width => (
        <Bar key={width} width={width} height={32} radius={16} />
      ))}
    </div>
    <SlidersSkeleton />
  </div>
)

interface MobileHomeProps {
  // null while they load: the sliders wait for them rather than say there is nothing.
  topics: TopicSummary[] | null
  onUnauthorized: () => void
}

interface Slider {
  topic: TopicSummary
  items: SearchItem[]
}

// Under the topics: the articles to resume, then a slider per topic; null sliders while they load.
const HomeBody = ({ feed, sliders }: { feed: ReturnType<typeof useFeedView>; sliders: Slider[] | null }) => {
  const { t } = useTranslation()
  if (feed.failed) return <PhoneFeedFailed title={t('feed.loadFailed')} onRetry={feed.refresh} />
  if (feed.waiting || sliders === null) return <SlidersSkeleton />
  return (
    <>
      <ResumePile layout="phone" />
      {sliders.map((slider, index) => (
        <div key={slider.topic.id} className="appear">
          {index > 0 && <div className={styles.divider} aria-hidden="true" />}
          <TopicSlider topic={slider.topic} items={slider.items} first={index < PRIORITY_SLIDERS} />
        </div>
      ))}
      {sliders.length === 0 && <FeedEmpty allHidden={feed.allHidden} nothing={t('feed.nothingNewPhone')} />}
    </>
  )
}

// The phone's home ("Tout"): the stories, the topics, the daily summary, then today's articles of each topic.
const MobileHome = ({ topics, onUnauthorized }: MobileHomeProps) => {
  const { t } = useTranslation()
  const feed = useFeedView('', onUnauthorized)
  const resumeReady = useResume(onUnauthorized)
  const { days } = useDayFeed('')
  const sections = useFrontPage()
  const frontPageSettled = useFrontPageSettled()
  const preferences = usePreferences()
  const { pull, refreshing } = usePullRefresh(feed.refresh)
  useReadState()
  const readable = useReadableOffline()

  // The latest day with articles, usually today.
  const latest = days[0]
  const items = (latest?.items ?? []).filter(item => !isHidden(item, preferences) && readable(item))
  const byTopic = (topics ?? [])
    .map(topic => ({ topic, items: items.filter(item => item.topicId === topic.id) }))
    .filter(slider => slider.items.length > 0)

  // A tablet held across shows the sidebar, with the logo and the avatar: the page names itself, as on a computer.
  const across = useIsTabletAcross()

  return (
    <div className={styles.home} aria-busy={feed.waiting}>
      <PhoneHeader
        title={across ? t('feed.title') : <Logo />}
        help={
          <HelpButton id="feed" title={t('help.feed.title')} layout="phone">
            <PageHelp page="feed" layout="phone" />
          </HelpButton>
        }
        meta={todayLabel()}
        actions={!across && <ProfileButton size={44} />}
        line
      />
      <PullIndicator pull={pull} refreshing={refreshing} loadedAt={feed.loadedAt} />

      {!frontPageSettled || (feed.waiting && !sections) ? (
        <HomeSkeleton />
      ) : (
        <>
          {sections && !feed.failed && <StoriesRow sections={sections} layout="phone" />}
          <MobileFilterRow topics={topics ?? []} selected={null} />
          <HomeBody feed={feed} sliders={topics === null || !resumeReady ? null : byTopic} />
        </>
      )}
    </div>
  )
}

export default MobileHome
