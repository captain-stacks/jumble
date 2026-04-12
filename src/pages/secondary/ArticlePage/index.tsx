import { Skeleton } from '@/components/ui/skeleton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { getWellKnownNip05Url } from '@/lib/nip05'
import NotePage from '@/pages/secondary/NotePage'
import { kinds, nip19 } from 'nostr-tools'
import { forwardRef, useEffect, useState } from 'react'

const ArticlePage = forwardRef(
  ({ domain, dtag, index }: { domain?: string; dtag?: string; index?: number }, ref) => {
    const [naddr, setNaddr] = useState<string | undefined>(undefined)
    const [error, setError] = useState<string | null>(null)
    const [resolving, setResolving] = useState(true)

    useEffect(() => {
      if (!domain || !dtag) {
        setError('Missing domain or article identifier')
        setResolving(false)
        return
      }

      let cancelled = false

      const load = async () => {
        try {
          const [name, host] = domain.includes('@') ? domain.split('@') : ['_', domain]
          const res = await fetch(getWellKnownNip05Url(host, name))
          const json = await res.json()
          const pubkey: string | undefined = json.names?.[name]
          if (!pubkey) throw new Error(`No NIP-05 entry for ${name}@${host}`)

          if (!cancelled) {
            setNaddr(nip19.naddrEncode({
              kind: kinds.LongFormArticle,
              pubkey,
              identifier: dtag
            }))
          }
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to resolve address')
        } finally {
          if (!cancelled) setResolving(false)
        }
      }

      load()
      return () => { cancelled = true }
    }, [domain, dtag])

    if (error) {
      return (
        <SecondaryPageLayout ref={ref} index={index} title="Article">
          <p className="px-4 pt-4 text-sm text-muted-foreground">{error}</p>
        </SecondaryPageLayout>
      )
    }

    if (resolving) {
      return (
        <SecondaryPageLayout ref={ref} index={index} title="">
          <div className="space-y-3 px-4 pt-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </SecondaryPageLayout>
      )
    }

    return <NotePage ref={ref} id={naddr} index={index} />
  }
)
ArticlePage.displayName = 'ArticlePage'
export default ArticlePage
