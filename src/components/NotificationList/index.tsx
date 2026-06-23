import { ExtendedKind, SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'
import { useInfiniteScroll } from '@/hooks'
import { useNotificationFilter } from '@/hooks/useNotificationFilter'
import { getAmountFromInvoice } from '@/lib/lightning'
import { REACTION_KINDS } from '@/lib/notification'
import { tagNameEquals } from '@/lib/tag'
import { cn, isTouchDevice } from '@/lib/utils'
import { usePrimaryPage } from '@/PageManager'
import { useDeepBrowsing } from '@/providers/DeepBrowsingProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useNotification } from '@/providers/NotificationProvider'
import localStorage from '@/services/local-storage.service'
import notificationService from '@/services/notification.service'
import { TNotificationType } from '@/types'
import dayjs from 'dayjs'
import { NostrEvent, kinds } from 'nostr-tools'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PullToRefresh from '../PullToRefresh'
import { LoadingBar } from '../LoadingBar'
import { RefreshButton } from '../RefreshButton'
import Tabs from '../Tabs'
import TrustScoreFilter from '../TrustScoreFilter'
import { NotificationItem } from './NotificationItem'
import { NotificationSkeleton } from './NotificationItem/Notification'

const SHOW_COUNT = 30
const LOAD_MORE_LIMIT = 100

export default function NotificationList() {
  const { t } = useTranslation()
  const { current } = usePrimaryPage()
  const { pubkey } = useNostr()
  const { getNotificationsSeenAt, hideReactions, setHideReactions } = useNotification()
  const { mutePubkeySet } = useMuteList()
  const filterFn = useNotificationFilter()
  const [notificationType, setNotificationType] = useState<TNotificationType>(
    () => localStorage.getLastNotificationType()
  )
  const notificationTypeRef = useRef(notificationType)
  notificationTypeRef.current = notificationType
  const [minZapAmount, setMinZapAmount] = useState(() => localStorage.getMinZapNotificationAmount())
  const [lastReadTime, setLastReadTime] = useState(0)
  const [mutedLastReadTime, setMutedLastReadTime] = useState(0)
  const [filteredEvents, setFilteredEvents] = useState<NostrEvent[]>([])
  const [mutedFilteredEvents, setMutedFilteredEvents] = useState<NostrEvent[]>([])
  const [initialLoading, setInitialLoading] = useState(notificationService.getInitialLoading())
  const supportTouch = useMemo(() => isTouchDevice(), [])
  const topRef = useRef<HTMLDivElement | null>(null)
  const filterKinds = useMemo(() => {
    switch (notificationType) {
      case 'mentions':
        return new Set<number>([
          kinds.ShortTextNote,
          kinds.Highlights,
          ExtendedKind.COMMENT,
          ExtendedKind.VOICE_COMMENT,
          ExtendedKind.POLL
        ])
      case 'reactions':
        return new Set<number>([
          kinds.Reaction,
          kinds.Repost,
          kinds.GenericRepost,
          ExtendedKind.POLL_RESPONSE
        ])
      case 'zaps':
        return new Set<number>([kinds.Zap])
      default:
        return null
    }
  }, [notificationType])

  // Snapshot the page-level last-read marker only when this page becomes
  // current. We deliberately don't react to subsequent changes of
  // `notificationsSeenAt` (e.g. the global update fired on entering this
  // page) — otherwise items would flip from unread to read mid-view.
  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (current !== 'notifications' || !pubkey) {
      if (wasActiveRef.current) {
        wasActiveRef.current = false
        const type = notificationTypeRef.current
        if (type !== 'all' && type !== 'mentions') {
          setNotificationType(localStorage.getLastNotificationType())
        }
      }
      return
    }
    if (wasActiveRef.current) return
    wasActiveRef.current = true
    setLastReadTime(getNotificationsSeenAt())
    setMutedLastReadTime(localStorage.getLastReadMutedNotificationTime(pubkey))
  }, [current, pubkey, getNotificationsSeenAt])

  // Track service loading state.
  useEffect(() => {
    setInitialLoading(notificationService.getInitialLoading())
    const unsub = notificationService.onLoadingChanged(setInitialLoading)
    return unsub
  }, [])

  // Recompute filtered events whenever the underlying data or filter inputs change.
  useEffect(() => {
    if (!pubkey) {
      setFilteredEvents([])
      return
    }

    let cancelled = false
    const cache = new Map<string, boolean>()

    const recompute = async () => {
      const events = notificationService.getEvents()
      const seenIds = new Set<string>()
      const passed: NostrEvent[] = []
      for (const evt of events) {
        if (seenIds.has(evt.id)) continue
        seenIds.add(evt.id)
        let ok = cache.get(evt.id)
        if (ok === undefined) {
          ok = await filterFn(evt)
          if (cancelled) return
          cache.set(evt.id, ok)
        }
        if (ok) passed.push(evt)
      }
      if (!cancelled) {
        setFilteredEvents(passed)
      }
    }

    recompute()
    const unsub = notificationService.onDataChanged(recompute)
    return () => {
      cancelled = true
      unsub()
    }
  }, [pubkey, filterFn])

  // Compute events from muted authors (for the Muted tab).
  useEffect(() => {
    if (!pubkey) {
      setMutedFilteredEvents([])
      return
    }

    let cancelled = false

    const recompute = () => {
      const events = notificationService.getEvents()
      const seenIds = new Set<string>()
      const passed: NostrEvent[] = []
      for (const evt of events) {
        if (seenIds.has(evt.id)) continue
        seenIds.add(evt.id)
        if (!mutePubkeySet.has(evt.pubkey)) continue
        if (evt.kind === kinds.Reaction) {
          const targetPubkey = evt.tags.findLast(tagNameEquals('p'))?.[1]
          if (targetPubkey !== pubkey) continue
        }
        passed.push(evt)
      }
      if (!cancelled) setMutedFilteredEvents(passed)
    }

    recompute()
    const unsub = notificationService.onDataChanged(recompute)
    return () => {
      cancelled = true
      unsub()
    }
  }, [pubkey, mutePubkeySet])

  const hasNewMutedNotifications = useMemo(
    () => mutedFilteredEvents.some((e) => e.created_at > mutedLastReadTime),
    [mutedFilteredEvents, mutedLastReadTime]
  )

  const hasNewReactionNotifications = useMemo(
    () =>
      notificationType === 'mentions' &&
      filteredEvents.some((e) => REACTION_KINDS.has(e.kind) && e.created_at > lastReadTime),
    [notificationType, filteredEvents, lastReadTime]
  )

  const hasNewZapNotifications = useMemo(
    () =>
      notificationType === 'mentions' &&
      filteredEvents.some((e) => {
        if (e.kind !== kinds.Zap || e.created_at <= lastReadTime) return false
        if (minZapAmount <= 0) return true
        const bolt11 = e.tags.find((t) => t[0] === 'bolt11')?.[1]
        return bolt11 ? getAmountFromInvoice(bolt11) >= minZapAmount : false
      }),
    [notificationType, filteredEvents, lastReadTime, minZapAmount]
  )

  const handleLoadMore = useCallback(async () => {
    return notificationService.loadMore(LOAD_MORE_LIMIT)
  }, [])

  const notifications = useMemo(() => {
    if (notificationType === 'muted') return mutedFilteredEvents
    const base =
      minZapAmount > 0
        ? filteredEvents.filter((evt) => {
            if (evt.kind !== kinds.Zap) return true
            const bolt11 = evt.tags.find((t) => t[0] === 'bolt11')?.[1]
            return bolt11 ? getAmountFromInvoice(bolt11) >= minZapAmount : false
          })
        : filteredEvents
    if (!filterKinds) return base
    return base.filter((evt) => filterKinds.has(evt.kind))
  }, [filteredEvents, mutedFilteredEvents, filterKinds, notificationType, minZapAmount])

  const { visibleItems, shouldShowLoadingIndicator, bottomRef, setShowCount } = useInfiniteScroll({
    items: notifications,
    showCount: SHOW_COUNT,
    onLoadMore: handleLoadMore,
    initialLoading
  })

  const groupedNotifications = useMemo(() => groupNotifications(visibleItems), [visibleItems])

  const refresh = () => {
    topRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
    setTimeout(() => {
      notificationService.restart()
    }, 500)
  }

  const list = (
    <div>
      {groupedNotifications.map((group) => (
        <Fragment key={group.key}>
          <NotificationGroupHeader label={group.label} />
          {group.items.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              isNew={
                notification.created_at >
                (notificationType === 'muted' ? mutedLastReadTime : lastReadTime)
              }
              skipMuteCheck={notificationType === 'muted'}
            />
          ))}
        </Fragment>
      ))}
      <div ref={bottomRef} />
      <div className="text-muted-foreground text-center text-sm">
        {notificationService.hasMore() || shouldShowLoadingIndicator ? (
          <NotificationSkeleton />
        ) : (
          t('no more notifications')
        )}
      </div>
    </div>
  )

  return (
    <div>
      <Tabs
        value={notificationType}
        tabs={[
          { value: 'all', label: 'All' },
          { value: 'mentions', label: 'Mentions' },
          {
            value: 'reactions',
            label: 'Reactions',
            strikethrough: hideReactions,
            dot: hasNewReactionNotifications,
            menu: hideReactions ? undefined : (
              <button
                className="w-full cursor-pointer text-start text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setHideReactions(true)
                  setNotificationType(localStorage.getLastNotificationType())
                }}
              >
                {t('hide reactions')}
              </button>
            )
          },
          {
            value: 'zaps',
            label: 'Zaps',
            dot: hasNewZapNotifications,
            menu: (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t('Min sats')}</span>
                <input
                  type="number"
                  min={0}
                  className="w-20 rounded-lg border bg-background px-2 py-1 text-sm outline-none"
                  value={minZapAmount}
                  onChange={(e) => {
                    const val = Math.max(0, parseInt(e.target.value) || 0)
                    setMinZapAmount(val)
                    localStorage.setMinZapNotificationAmount(val)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )
          },
          { value: 'muted', label: 'Muted', dot: hasNewMutedNotifications }
        ]}
        onTabChange={(type) => {
          if (type === 'reactions' && hideReactions) {
            setHideReactions(false)
          }
          setShowCount(SHOW_COUNT)
          setNotificationType(type as TNotificationType)
          if (type === 'all' || type === 'mentions') localStorage.setLastNotificationType(type)
          topRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
          if (type === 'muted' && pubkey) {
            const now = dayjs().unix()
            setMutedLastReadTime(now)
            localStorage.setLastReadMutedNotificationTime(pubkey, now)
          }
        }}
        options={
          <>
            {!supportTouch ? <RefreshButton onClick={() => refresh()} /> : null}
            {notificationType !== 'muted' && (
              <TrustScoreFilter filterId={SPECIAL_TRUST_SCORE_FILTER_ID.NOTIFICATIONS} />
            )}
          </>
        }
      />
      <div ref={topRef} className="scroll-mt-24.25" />
      {initialLoading && shouldShowLoadingIndicator && <LoadingBar />}
      <PullToRefresh
        onRefresh={async () => {
          refresh()
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }}
      >
        {list}
      </PullToRefresh>
    </div>
  )
}

type TNotificationGroupKey = 'today' | 'week' | 'month' | 'earlier'

const GROUP_LABELS: Record<TNotificationGroupKey, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  earlier: 'Earlier'
}

function groupNotifications(events: NostrEvent[]) {
  const now = dayjs()
  const todayStart = now.startOf('day').unix()
  const weekStart = now.startOf('week').unix()
  const monthStart = now.startOf('month').unix()

  const groups: { key: TNotificationGroupKey; label: string; items: NostrEvent[] }[] = []
  let current: { key: TNotificationGroupKey; label: string; items: NostrEvent[] } | null = null

  for (const evt of events) {
    let key: TNotificationGroupKey
    if (evt.created_at >= todayStart) key = 'today'
    else if (evt.created_at >= weekStart) key = 'week'
    else if (evt.created_at >= monthStart) key = 'month'
    else key = 'earlier'

    if (!current || current.key !== key) {
      current = { key, label: GROUP_LABELS[key], items: [] }
      groups.push(current)
    }
    current.items.push(evt)
  }
  return groups
}

function NotificationGroupHeader({ label }: { label: string }) {
  const { t } = useTranslation()
  const { deepBrowsing } = useDeepBrowsing()

  return (
    <div
      className={cn(
        'bg-border text-muted-foreground sticky z-20 border-b px-4 py-1 text-sm font-semibold backdrop-blur-md transition-[top] duration-300',
        deepBrowsing ? 'top-12' : 'top-24.25'
      )}
    >
      {t(label)}
    </div>
  )
}
