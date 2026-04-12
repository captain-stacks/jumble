import LongFormArticle from '@/components/Note/LongFormArticle'
import { Skeleton } from '@/components/ui/skeleton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { getWellKnownNip05Url } from '@/lib/nip05'
import client from '@/services/client.service'
import { Event, kinds } from 'nostr-tools'
import { forwardRef, useEffect, useState } from 'react'

const ArticlePage = forwardRef(
  ({ domain, dtag, index }: { domain?: string; dtag?: string; index?: number }, ref) => {
    const [event, setEvent] = useState<Event | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isFetching, setIsFetching] = useState(true)

    useEffect(() => {
      if (!domain || !dtag) {
        setError('Missing domain or article identifier')
        setIsFetching(false)
        return
      }

      let cancelled = false

      const load = async () => {
        try {
          // Support optional name prefix (name@domain or just domain → _@domain)
          const [name, host] = domain.includes('@') ? domain.split('@') : ['_', domain]

          const res = await fetch(getWellKnownNip05Url(host, name))
          const json = await res.json()
          const pubkey: string | undefined = json.names?.[name]
          if (!pubkey) throw new Error(`No NIP-05 entry for ${name}@${host}`)

          const events = await client.fetchEvents([], {
            kinds: [kinds.LongFormArticle],
            authors: [pubkey],
            '#d': [dtag],
            limit: 1
          })

          if (cancelled) return
          const found = events[0] ?? null
          setEvent(found)
          if (!found) setError('Article not found')
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load article')
        } finally {
          if (!cancelled) setIsFetching(false)
        }
      }

      load()
      return () => { cancelled = true }
    }, [domain, dtag])

    const title = event
      ? (event.tags.find(([t]) => t === 'title')?.[1] ?? 'Article')
      : 'Article'

    return (
      <SecondaryPageLayout ref={ref} index={index} title={title} displayScrollToTopButton>
        {isFetching && (
          <div className="space-y-3 px-4 pt-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {error && !isFetching && (
          <p className="px-4 pt-4 text-sm text-muted-foreground">{error}</p>
        )}
        {event && !isFetching && (
          <div className="px-4 pt-4">
            <LongFormArticle event={event} />
          </div>
        )}
      </SecondaryPageLayout>
    )
  }
)
ArticlePage.displayName = 'ArticlePage'
export default ArticlePage
