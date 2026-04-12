import { getWellKnownNip05Url } from '@/lib/nip05'
import NotePage from '@/pages/secondary/NotePage'
import { kinds, nip19 } from 'nostr-tools'
import { forwardRef, useEffect, useState } from 'react'

const ArticlePage = forwardRef(
  ({ domain, dtag, index }: { domain?: string; dtag?: string; index?: number }, ref) => {
    const [naddr, setNaddr] = useState<string | undefined>(undefined)

    useEffect(() => {
      if (!domain || !dtag) return
      let cancelled = false

      const load = async () => {
        try {
          const [name, host] = domain.includes('@') ? domain.split('@') : ['_', domain]
          const res = await fetch(getWellKnownNip05Url(host, name))
          const json = await res.json()
          const pubkey: string | undefined = json.names?.[name]
          if (!pubkey || cancelled) return

          setNaddr(nip19.naddrEncode({
            kind: kinds.LongFormArticle,
            pubkey,
            identifier: dtag
          }))
        } catch {
          // NotePage will show "not found" when naddr stays undefined
        }
      }

      load()
      return () => { cancelled = true }
    }, [domain, dtag])

    return <NotePage ref={ref} id={naddr} index={index} />
  }
)
ArticlePage.displayName = 'ArticlePage'
export default ArticlePage
