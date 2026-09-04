import FeedSwitcher from '@/components/FeedSwitcher'
import RelayIcon from '@/components/RelayIcon'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { IS_COMMUNITY_MODE, COMMUNITY_RELAY_SETS, COMMUNITY_RELAYS } from '@/constants'
import { useRelayConnectionStatus } from '@/hooks/useRelayConnectionStatus'
import { simplifyUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ChevronDown, FolderClosed, Globe, Server, Star, UsersRound } from 'lucide-react'
import { forwardRef, HTMLAttributes, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function FeedButton({
  className,
  compact = false
}: {
  className?: string
  compact?: boolean
}) {
  const { isSmallScreen } = useScreenSize()
  const [open, setOpen] = useState(false)

  if (IS_COMMUNITY_MODE && COMMUNITY_RELAY_SETS.length + COMMUNITY_RELAYS.length <= 1) {
    return <FeedSwitcherTrigger className={className} compact={compact} />
  }

  if (isSmallScreen) {
    return (
      <>
        <FeedSwitcherTrigger
          className={className}
          compact={compact}
          onClick={() => setOpen(true)}
        />
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="max-h-[85vh]">
            <div
              className="flex-1 overflow-y-auto overscroll-contain px-4 py-3"
              style={{
                touchAction: 'pan-y',
                WebkitOverflowScrolling: 'touch'
              }}
            >
              <FeedSwitcher close={() => setOpen(false)} />
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FeedSwitcherTrigger className={className} compact={compact} />
      </PopoverTrigger>
      <PopoverContent sideOffset={0} side="bottom" className="w-[400px] overflow-hidden p-0">
        <div
          className="max-h-[calc(100vh-16rem)] overflow-y-auto overscroll-contain px-4 py-3"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <FeedSwitcher close={() => setOpen(false)} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

const FeedSwitcherTrigger = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { compact?: boolean }
>(({ className, compact = false, ...props }, ref) => {
  const { t } = useTranslation()
  const { feedInfo, relayUrls, noteEvaluationFlashCount } = useFeed()
  const { relaySets } = useFavoriteRelays()
  const activeRelaySet = useMemo(() => {
    return feedInfo?.feedType === 'relays' && feedInfo.id
      ? (relaySets.find((set) => set.id === feedInfo.id) ??
          COMMUNITY_RELAY_SETS.find((set) => set.id === feedInfo.id))
      : undefined
  }, [feedInfo, relaySets])
  const title = useMemo(() => {
    if (feedInfo?.feedType === 'following') {
      return t('Following')
    }
    if (feedInfo?.feedType === 'pinned') {
      return t('Special Follow')
    }
    if (feedInfo?.feedType === 'global') {
      return t('Global')
    }
    if (relayUrls.length === 0) {
      return t('Choose a feed')
    }
    if (feedInfo?.feedType === 'relay') {
      return simplifyUrl(feedInfo?.id ?? '')
    }
    if (feedInfo?.feedType === 'relays') {
      return feedInfo.name ?? activeRelaySet?.name ?? activeRelaySet?.id
    }
  }, [feedInfo, activeRelaySet])

  const icon = useMemo(() => {
    if (feedInfo?.feedType === 'relay' && feedInfo.id) {
      return <RelayIcon url={feedInfo.id} />
    }

    const Inner = () => {
      if (feedInfo?.feedType === 'following')
        return <UsersRound className={compact ? 'size-3.5!' : ''} />
      if (feedInfo?.feedType === 'pinned') return <Star className={compact ? 'size-3.5!' : ''} />
      if (feedInfo?.feedType === 'global') return <Globe className={compact ? 'size-3.5!' : ''} />
      if (feedInfo?.feedType === 'relays')
        return <FolderClosed className={compact ? 'size-3.5!' : ''} />
      return <Server className={compact ? 'size-3.5!' : ''} />
    }

    if (compact) {
      return (
        <div className="flex items-center ps-1.5">
          <Inner />
        </div>
      )
    }

    return <Inner />
  }, [feedInfo, compact])

  const clickable = !IS_COMMUNITY_MODE || COMMUNITY_RELAY_SETS.length + COMMUNITY_RELAYS.length > 1
  const { relays } = useRelayConnectionStatus()

  return (
    <div
      className={cn(
        'clickable flex items-center',
        compact ? 'bg-muted h-8 gap-1.5 rounded-full ps-1 pe-1.5' : 'h-full gap-2 rounded-xl px-3',
        !clickable && 'cursor-default!',
        className
      )}
      ref={ref}
      {...props}
    >
      <div className="shrink-0">{icon}</div>
      <div className={cn('min-w-0 flex-1 truncate font-semibold', compact ? 'text-sm' : 'text-lg')}>
        {title}
      </div>
      {clickable && <ChevronDown className={cn('shrink-0', compact ? 'size-3!' : '')} />}
      {noteEvaluationFlashCount > 0 && (
        <span
          key={noteEvaluationFlashCount}
          aria-hidden="true"
          className="bg-destructive size-1.5 shrink-0 [animation:dotFlash_0.6s_ease-out_forwards] rounded-full"
        />
      )}
      {relays.length > 0 && (
        <div
          className="min-w-0 shrink truncate text-xs"
          title={relays
            .map(
              ({ url, connected }) =>
                `${simplifyUrl(url)}: ${connected ? t('Connected') : t('Disconnected')}`
            )
            .join('\n')}
        >
          {relays.map(({ url, connected }, i) => (
            <span key={url} className={connected ? 'text-emerald-500' : 'text-destructive'}>
              {i > 0 && <span className="text-muted-foreground">, </span>}
              {simplifyUrl(url)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
})
