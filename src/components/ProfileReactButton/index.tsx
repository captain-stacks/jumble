import LikeButton from '@/components/StuffStats/LikeButton'
import indexedDb from '@/services/indexed-db.service'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useState } from 'react'

export default function ProfileReactButton({ pubkey }: { pubkey: string }) {
  const [profileEvent, setProfileEvent] = useState<Event | undefined>()

  useEffect(() => {
    indexedDb.getReplaceableEvent(pubkey, kinds.Metadata).then((event) => {
      if (event) setProfileEvent(event)
    })
  }, [pubkey])

  if (!profileEvent) return null

  return <LikeButton stuff={profileEvent} />
}
