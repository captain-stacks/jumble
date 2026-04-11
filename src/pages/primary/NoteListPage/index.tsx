import { usePrimaryPage, useSecondaryPage } from '@/PageManager'
import FollowingFeed from '@/components/FollowingFeed'
import PostEditor from '@/components/PostEditor'
import RelayInfo from '@/components/RelayInfo'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { toSearch } from '@/lib/link'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TPageRef } from '@/types'
import { Compass, Info, LogIn, PencilLine, Search, Sparkles } from 'lucide-react'
import {
  Dispatch,
  forwardRef,
  SetStateAction,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import FeedButton from './FeedButton'
import PinnedFeed from './PinnedFeed'
import RelaysFeed from './RelaysFeed'

const NoteListPage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { addRelayUrls, removeRelayUrls } = useCurrentRelays()
  const layoutRef = useRef<TPageRef>(null)
  const { pubkey } = useNostr()
  const { feedInfo, relayUrls, isReady, switchFeed } = useFeed()
  const { isWotReady } = useUserTrust()
  const [showRelayDetails, setShowRelayDetails] = useState(false)

  useImperativeHandle(ref, () => layoutRef.current as TPageRef)

  useEffect(() => {
    if (layoutRef.current) {
      layoutRef.current.scrollToTop('instant')
    }
  }, [JSON.stringify(relayUrls), feedInfo])

  useEffect(() => {
    if (relayUrls.length) {
      addRelayUrls(relayUrls)
      return () => {
        removeRelayUrls(relayUrls)
      }
    }
  }, [relayUrls])

  let content: React.ReactNode = null
  if (!isReady || (!pubkey && !isWotReady)) {
    content = pubkey ? (
      <div className="pt-3 text-center text-sm text-muted-foreground">{t('loading...')}</div>
    ) : (
      <GuestLoadingScreen />
    )
  } else if (!feedInfo) {
    content = <WelcomeGuide />
  } else if (feedInfo.feedType === 'following' && !pubkey) {
    switchFeed(null)
    return null
  } else if (feedInfo.feedType === 'pinned' && !pubkey) {
    switchFeed(null)
    return null
  } else if (feedInfo.feedType === 'following') {
    content = <FollowingFeed />
  } else if (feedInfo.feedType === 'pinned') {
    content = <PinnedFeed />
  } else if (feedInfo.feedType === 'global') {
    content = <RelaysFeed />
  } else {
    content = (
      <>
        {showRelayDetails && feedInfo.feedType === 'relay' && !!feedInfo.id && (
          <RelayInfo url={feedInfo.id!} className="mb-2 pt-3" />
        )}
        <RelaysFeed />
      </>
    )
  }

  return (
    <PrimaryPageLayout
      pageName="home"
      ref={layoutRef}
      titlebar={
        <NoteListPageTitlebar
          layoutRef={layoutRef}
          showRelayDetails={showRelayDetails}
          setShowRelayDetails={
            feedInfo?.feedType === 'relay' && !!feedInfo.id ? setShowRelayDetails : undefined
          }
        />
      }
      displayScrollToTopButton
    >
      {content}
    </PrimaryPageLayout>
  )
})
NoteListPage.displayName = 'NoteListPage'
export default NoteListPage

const GUEST_LOADING_STEPS = [
  { icon: '🔌', label: 'Connecting to relays...' },
  { icon: '🕸️', label: 'Building web of trust...' },
  { icon: '👥', label: 'Fetching follow list...' },
  { icon: '🛡️', label: 'Filtering trusted notes...' },
  { icon: '✨', label: 'Almost there...' }
]

function GuestLoadingScreen() {
  const [stepIndex, setStepIndex] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Small delay so the screen fades in rather than flashing
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, GUEST_LOADING_STEPS.length - 1))
    }, 1400)
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      className={`flex min-h-[60vh] flex-col items-center justify-center gap-8 px-6 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="flex flex-col gap-4 w-full max-w-xs">
        {GUEST_LOADING_STEPS.map(({ icon, label }, i) => {
          const isDone = i < stepIndex
          const isActive = i === stepIndex
          const isFuture = i > stepIndex
          return (
            <div
              key={label}
              className={`flex items-center gap-4 transition-all duration-500 ${isFuture ? 'opacity-20' : 'opacity-100'}`}
            >
              <div
                className={`flex size-10 flex-shrink-0 items-center justify-center rounded-full text-xl transition-all duration-500 ${
                  isDone
                    ? 'bg-primary/20'
                    : isActive
                      ? 'bg-primary/10 ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'bg-muted'
                }`}
              >
                <span className={isActive ? 'animate-bounce' : ''}>{icon}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span
                  className={`font-medium transition-all duration-500 ${
                    isDone ? 'text-muted-foreground line-through' : isActive ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {label}
                </span>
                {isActive && (
                  <div className="flex gap-1">
                    <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                    <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                    <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                  </div>
                )}
                {isDone && (
                  <span className="text-xs text-primary">Done</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NoteListPageTitlebar({
  layoutRef,
  showRelayDetails,
  setShowRelayDetails
}: {
  layoutRef?: React.RefObject<TPageRef>
  showRelayDetails?: boolean
  setShowRelayDetails?: Dispatch<SetStateAction<boolean>>
}) {
  const { isSmallScreen } = useScreenSize()

  return (
    <div className="flex h-full items-center justify-between gap-1">
      <FeedButton className="w-0 max-w-fit flex-1" />
      <div className="flex shrink-0 items-center gap-1">
        {setShowRelayDetails && (
          <Button
            variant="ghost"
            size="titlebar-icon"
            onClick={(e) => {
              e.stopPropagation()
              setShowRelayDetails((show) => !show)

              if (!showRelayDetails) {
                layoutRef?.current?.scrollToTop('smooth')
              }
            }}
            className={showRelayDetails ? 'bg-muted/40' : ''}
          >
            <Info />
          </Button>
        )}
        {isSmallScreen && (
          <>
            <SearchButton />
            <PostButton />
          </>
        )}
      </div>
    </div>
  )
}

function PostButton() {
  const { checkLogin } = useNostr()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="titlebar-icon"
        onClick={(e) => {
          e.stopPropagation()
          checkLogin(() => {
            setOpen(true)
          })
        }}
      >
        <PencilLine />
      </Button>
      <PostEditor open={open} setOpen={setOpen} />
    </>
  )
}

function SearchButton() {
  const { push } = useSecondaryPage()

  return (
    <Button variant="ghost" size="titlebar-icon" onClick={() => push(toSearch())}>
      <Search />
    </Button>
  )
}

function WelcomeGuide() {
  const { t } = useTranslation()
  const { navigate } = usePrimaryPage()
  const { checkLogin } = useNostr()

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 px-4 text-center">
      <div className="space-y-2">
        <div className="flex w-full items-center justify-center gap-2">
          <Sparkles className="text-yellow-400" />
          <h2 className="text-2xl font-bold">{t('Welcome to Jumble')}</h2>
          <Sparkles className="text-yellow-400" />
        </div>
        <p className="max-w-md text-muted-foreground">
          {t(
            'Jumble is a client focused on browsing relays. Get started by exploring interesting relays or login to view your following feed.'
          )}
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
        <Button size="lg" className="w-full" onClick={() => navigate('explore')}>
          <Compass className="size-5" />
          {t('Explore')}
        </Button>

        <Button size="lg" className="w-full" variant="outline" onClick={() => checkLogin()}>
          <LogIn className="size-5" />
          {t('Login')}
        </Button>
      </div>
    </div>
  )
}
