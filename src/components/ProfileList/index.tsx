import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import UserItem from '../UserItem'

export default function ProfileList({ pubkeys }: { pubkeys: string[] }) {
  const [showAll, setShowAll] = useState(false)
  const [visiblePubkeys, setVisiblePubkeys] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setShowAll(false)
    setVisiblePubkeys(pubkeys.slice(0, 10))
  }, [pubkeys])

  useEffect(() => {
    if (showAll) return
    const options = { root: null, rootMargin: '10px', threshold: 1 }
    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && pubkeys.length > visiblePubkeys.length) {
        setVisiblePubkeys((prev) => [...prev, ...pubkeys.slice(prev.length, prev.length + 10)])
      }
    }, options)
    const currentBottomRef = bottomRef.current
    if (currentBottomRef) observerInstance.observe(currentBottomRef)
    return () => {
      if (observerInstance && currentBottomRef) observerInstance.unobserve(currentBottomRef)
    }
  }, [visiblePubkeys, pubkeys, showAll])

  const hiddenPubkeys = pubkeys.slice(visiblePubkeys.length)

  return (
    <div className="px-4 pt-2">
      {(showAll ? pubkeys : visiblePubkeys).map((pubkey, index) => (
        <UserItem key={`${index}-${pubkey}`} userId={pubkey} />
      ))}
      {!showAll && hiddenPubkeys.length > 0 && (
        <div className="relative">
          <div className="pointer-events-none select-none opacity-30 blur-sm">
            {hiddenPubkeys.slice(0, 5).map((pubkey, index) => (
              <UserItem key={`blur-${index}-${pubkey}`} userId={pubkey} />
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Button variant="secondary" onClick={() => setShowAll(true)}>
              Show all {pubkeys.length}
            </Button>
          </div>
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
