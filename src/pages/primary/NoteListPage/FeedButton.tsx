import FeedSwitcher from '@/components/FeedSwitcher'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { simplifyUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { BookmarkIcon, ChevronDown, Server, UsersRound } from 'lucide-react'
import { forwardRef, HTMLAttributes, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function FeedButton({ className }: { className?: string }) {
  const { isSmallScreen } = useScreenSize()
  const [open, setOpen] = useState(false)

  if (isSmallScreen) {
    return (
      <>
        <FeedSwitcherTrigger className={className} onClick={() => setOpen(true)} />
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="max-h-[80vh]">
            <div className="py-4 px-2 overflow-auto">
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
        <FeedSwitcherTrigger className={className} />
      </PopoverTrigger>
      <PopoverContent side="bottom" className="w-300 p-4 max-h-[80vh] overflow-auto">
        <FeedSwitcher close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

const FeedSwitcherTrigger = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation()
    const { feedInfo, relayUrls } = useFeed()
    const { relaySets } = useFavoriteRelays()
    const activeRelaySet = useMemo(() => {
      return feedInfo.feedType === 'relays' && feedInfo.id
        ? relaySets.find((set) => set.id === feedInfo.id)
        : undefined
    }, [feedInfo, relaySets])
    const title = useMemo(() => {
      if (feedInfo.feedType === 'following') {
        return t('Following')
      }
      if (feedInfo.feedType === 'bookmarks') {
        return t('Bookmarks')
      }
      if (feedInfo.feedType === 'notstr') {
        return t('notstr')
      }
      if (feedInfo.feedType === 'algo') {
        return t('algo')
      }
      if (relayUrls.length === 0) {
        return t('Choose a relay')
      }
      if (feedInfo.feedType === 'relay') {
        return simplifyUrl(feedInfo.id ?? '')
      }
      if (feedInfo.feedType === 'relays') {
        return activeRelaySet?.name ?? activeRelaySet?.id
      }
      if (feedInfo.feedType === 'temporary') {
        return relayUrls.length === 1
          ? simplifyUrl(relayUrls[0])
          : (activeRelaySet?.name ?? t('Temporary'))
      }
    }, [feedInfo, activeRelaySet])

    return (
      <div
        className={cn('flex items-center gap-2 clickable px-3 h-full rounded-lg', className)}
        ref={ref}
        {...props}
      >
        {feedInfo.feedType === 'following' ? (
          <UsersRound />
        ) : feedInfo.feedType === 'bookmarks' ? (
          <BookmarkIcon />
        ) : (
          <Server />
        )}
        <div className="text-lg font-semibold truncate">{title}</div>
        <ChevronDown />
      </div>
    )
  }
)
