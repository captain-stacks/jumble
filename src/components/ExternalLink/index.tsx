import { useSecondaryPage } from '@/PageManager'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerOverlay } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { toExternalContent } from '@/lib/link'
import { truncateUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ExternalLink as ExternalLinkIcon, MessageSquare } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function ExternalLink({
  url,
  className,
  justOpenLink
}: {
  url: string
  className?: string
  justOpenLink?: boolean
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { push } = useSecondaryPage()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [triggerPos, setTriggerPos] = useState({ top: 0, left: 0 })
  const displayUrl = useMemo(() => truncateUrl(url), [url])
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>()
  const isLongPress = useRef(false)

  const handleOpenLink = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isSmallScreen) {
      setIsDrawerOpen(false)
    }
    window.open(url, '_blank', 'noreferrer')
  }

  const handleViewDiscussions = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isSmallScreen) {
      setIsDrawerOpen(false)
      setTimeout(() => push(toExternalContent(url)), 100) // wait for drawer to close
      return
    }
    push(toExternalContent(url))
  }

  if (justOpenLink) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={cn('cursor-pointer text-primary hover:underline', className)}
        onClick={(e) => e.stopPropagation()}
      >
        {displayUrl}
      </a>
    )
  }

  if (isSmallScreen) {
    const handleTouchStart = () => {
      isLongPress.current = false
      longPressTimer.current = setTimeout(() => {
        isLongPress.current = true
        setIsDrawerOpen(true)
      }, 500)
    }

    const handleTouchMove = () => {
      clearTimeout(longPressTimer.current)
    }

    const handleTouchEnd = () => {
      clearTimeout(longPressTimer.current)
    }

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isLongPress.current) {
        isLongPress.current = false
        return
      }
      window.open(url, '_blank', 'noreferrer')
    }

    return (
      <>
        <span
          className={cn('cursor-pointer text-primary hover:underline', className)}
          title={url}
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {displayUrl}
        </span>
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerOverlay
            onClick={(e) => {
              e.stopPropagation()
              setIsDrawerOpen(false)
            }}
          />
          <DrawerContent hideOverlay>
            <div className="py-2">
              <Button
                onClick={handleOpenLink}
                className="w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                variant="ghost"
              >
                <ExternalLinkIcon />
                {t('Open link')}
              </Button>
              <Button
                onClick={handleViewDiscussions}
                className="w-full justify-start gap-4 p-6 text-lg [&_svg]:size-5"
                variant="ghost"
              >
                <MessageSquare />
                {t('View Nostr discussions')}
              </Button>
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.open(url, '_blank', 'noreferrer')
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTriggerPos({
      top: e.clientY - rect.top,
      left: e.clientX - rect.left
    })
    setIsDropdownOpen(true)
  }

  return (
    <span
      className={cn('relative cursor-pointer text-primary hover:underline', className)}
      title={url}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {displayUrl}
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger
          className="absolute size-0 overflow-hidden p-0 opacity-0"
          style={{ top: triggerPos.top, left: triggerPos.left }}
        />
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={handleOpenLink}>
            <ExternalLinkIcon />
            {t('Open link')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleViewDiscussions}>
            <MessageSquare />
            {t('View Nostr discussions')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
